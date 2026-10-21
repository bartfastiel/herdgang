// HTTP layer: passkey sign-in with invite links, sessions, the check for Caddy (forward_auth), sync of the cookbook
// records (recipes, revisions, comments), invites and members, push subscriptions and kitchen timers.
//
// Conventions: errors as {"error": {"code", "message"}} (messages in German, they are shown in the app), fields in
// snake_case, times in milliseconds. Every changing request needs a matching Origin header. Session cookie `__Host-hg`
// (HttpOnly, Secure, SameSite=Lax); only the SHA-256 of the token is stored. Sessions last 90 days from last use.
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import type { DatabaseSync } from 'node:sqlite';
import type { Sender, Subscription } from './push.ts';
import { b64url, verifyAssertion, verifyRegistration } from './webauthn.ts';

export interface Config {
  db: DatabaseSync;
  /** allowed origins, e.g. https://herdgang.example.org; the first one is the main address */
  origins: string[];
  rpId: string;
  rpName?: string;
  trustProxy?: boolean;
  /** VAPID public key and sender for timer notifications (omitted: timers only ring inside the app) */
  push?: { publicKey: string; send: Sender };
  /** development and tests only: serve this directory with the same access check as Caddy */
  staticDir?: string;
  now?: () => number;
}

export const SESSION_COOKIE = '__Host-hg';
const SESSION_TTL = 90 * 24 * 3600 * 1000;
const CHALLENGE_TTL = 5 * 60 * 1000;
export const STORES = ['recipes', 'revisions', 'comments'];
export const ROLES = ['owner', 'editor', 'reader'];
/** reachable without a session (sign-in page, icons, manifest) */
const PUBLIC_PATHS = /^\/(login\/.*|icon[^/]*\.(svg|png)|manifest\.webmanifest|robots\.txt|favicon\.ico)$/;

/** STATIC_DIR only (development, tests): the same CSP as Caddy in production */
export const CSP =
  "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data: blob:; media-src 'self' blob: data:; connect-src 'self'; worker-src 'self'; manifest-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

export class HttpError extends Error {
  status: number;
  code: string;
  constructor(status: number, code: string, message: string) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

const sha256hex = (s: string) => createHash('sha256').update(s).digest('hex');
const token = (bytes = 32) => b64url(randomBytes(bytes));

interface Session {
  userId: string;
  name: string;
  hash: string;
}

interface Invite {
  hash: string;
  cookbook_id: string;
  cookbook_name: string;
  role: string;
  name: string | null;
  user_id: string | null;
}

/** next value for records.received: strictly increasing, also across the CLI writing into the same database */
export function nextReceived(db: DatabaseSync, now: number): number {
  const r = db.prepare('SELECT max(received) AS m FROM records').get() as { m: number | null };
  return Math.max(now, Number(r.m || 0) + 1);
}

export function createApp(cfg: Config) {
  const { db } = cfg;
  const now = cfg.now || Date.now;
  const failures = new Map<string, number[]>();

  const audit = (event: string, userId: string | null, ip: string, detail?: string) =>
    db.prepare('INSERT INTO audit (time, user_id, event, ip, detail) VALUES (?, ?, ?, ?, ?)').run(now(), userId, event, ip, detail || null);

  function clientIp(req: IncomingMessage): string {
    if (cfg.trustProxy) {
      const xff = String(req.headers['x-forwarded-for'] || '').split(',').map((s) => s.trim()).filter(Boolean);
      if (xff.length) return xff[xff.length - 1];
    }
    return req.socket.remoteAddress || '';
  }

  function limited(ip: string): boolean {
    const t = now();
    const list = (failures.get(ip) || []).filter((x) => t - x < 15 * 60 * 1000);
    failures.set(ip, list);
    return list.length >= 20;
  }

  function fail(ip: string): void {
    const list = failures.get(ip) || [];
    list.push(now());
    failures.set(ip, list);
  }

  function cookies(req: IncomingMessage): Record<string, string> {
    const out: Record<string, string> = {};
    for (const part of String(req.headers.cookie || '').split(';')) {
      const i = part.indexOf('=');
      if (i > 0) out[part.slice(0, i).trim()] = part.slice(i + 1).trim();
    }
    return out;
  }

  function session(req: IncomingMessage): Session | null {
    const raw = cookies(req)[SESSION_COOKIE];
    if (!raw) return null;
    const hash = sha256hex(raw);
    const row = db
      .prepare('SELECT s.user_id, s.last_used, u.name, u.disabled FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?')
      .get(hash) as { user_id: string; last_used: number; name: string; disabled: number } | undefined;
    if (!row || row.disabled || now() - row.last_used > SESSION_TTL) return null;
    if (now() - row.last_used > 3600 * 1000) db.prepare('UPDATE sessions SET last_used = ? WHERE token_hash = ?').run(now(), hash);
    return { userId: row.user_id, name: row.name, hash };
  }

  function requireSession(req: IncomingMessage): Session {
    const s = session(req);
    if (!s) throw new HttpError(401, 'unauthenticated', 'Bitte anmelden.');
    return s;
  }

  function role(userId: string, cookbookId: unknown): string {
    if (typeof cookbookId !== 'string' || !cookbookId) throw new HttpError(400, 'bad_request', 'Kochbuch fehlt.');
    const r = db.prepare('SELECT role FROM members WHERE cookbook_id = ? AND user_id = ?').get(cookbookId, userId) as { role: string } | undefined;
    if (!r) throw new HttpError(403, 'forbidden', 'Kein Zugang zu diesem Kochbuch.');
    return r.role;
  }

  function startSession(res: ServerResponse, userId: string, req: IncomingMessage): void {
    const t = token();
    db.prepare('INSERT INTO sessions (token_hash, user_id, created, last_used, user_agent) VALUES (?, ?, ?, ?, ?)').run(
      sha256hex(t),
      userId,
      now(),
      now(),
      String(req.headers['user-agent'] || '').slice(0, 200),
    );
    res.setHeader('Set-Cookie', `${SESSION_COOKIE}=${t}; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=34560000`);
  }

  function newChallenge(kind: string, inviteHash: string | null, userId?: string): { id: string; challenge: string } {
    db.prepare('DELETE FROM challenges WHERE created < ?').run(now() - CHALLENGE_TTL);
    const c = { id: randomUUID(), challenge: token() };
    db.prepare('INSERT INTO challenges (id, challenge, kind, invite_hash, created) VALUES (?, ?, ?, ?, ?)').run(c.id, c.challenge + (userId ? '|' + userId : ''), kind, inviteHash, now());
    return c;
  }

  function takeChallenge(id: unknown, kind: string): { challenge: string; userId: string | null; invite_hash: string | null } {
    if (typeof id !== 'string') throw new HttpError(400, 'bad_request', 'Challenge fehlt.');
    const row = db.prepare('SELECT * FROM challenges WHERE id = ? AND kind = ?').get(id, kind) as { challenge: string; invite_hash: string | null; created: number } | undefined;
    db.prepare('DELETE FROM challenges WHERE id = ?').run(id);
    if (!row || now() - row.created > CHALLENGE_TTL) throw new HttpError(400, 'challenge_expired', 'Die Anmeldung hat zu lange gedauert. Bitte noch einmal.');
    const [challenge, userId] = row.challenge.split('|');
    return { challenge, userId: userId || null, invite_hash: row.invite_hash };
  }

  function validInvite(code: unknown): Invite {
    if (typeof code !== 'string' || !code) throw new HttpError(404, 'invite_invalid', 'Die Einladung ist ungültig oder abgelaufen.');
    const hash = sha256hex(code);
    const row = db
      .prepare('SELECT i.*, c.name AS cookbook_name FROM invites i JOIN cookbooks c ON c.id = i.cookbook_id WHERE i.code_hash = ?')
      .get(hash) as (Invite & { expires: number; used: number | null }) | undefined;
    if (!row || row.used || row.expires < now()) throw new HttpError(404, 'invite_invalid', 'Die Einladung ist ungültig oder abgelaufen.');
    if (row.user_id) {
      const u = db.prepare('SELECT disabled FROM users WHERE id = ?').get(row.user_id) as { disabled: number } | undefined;
      if (!u || u.disabled) throw new HttpError(404, 'invite_invalid', 'Die Einladung ist ungültig oder abgelaufen.');
    }
    return { hash, cookbook_id: row.cookbook_id, cookbook_name: row.cookbook_name, role: row.role, name: row.name, user_id: row.user_id };
  }

  function joinCookbook(userId: string, inv: Invite): void {
    const existing = db.prepare('SELECT role FROM members WHERE cookbook_id = ? AND user_id = ?').get(inv.cookbook_id, userId) as { role: string } | undefined;
    // joining never lowers an existing role
    if (!existing) db.prepare('INSERT INTO members (cookbook_id, user_id, role, created) VALUES (?, ?, ?, ?)').run(inv.cookbook_id, userId, inv.role, now());
    else if (ROLES.indexOf(inv.role) < ROLES.indexOf(existing.role)) db.prepare('UPDATE members SET role = ? WHERE cookbook_id = ? AND user_id = ?').run(inv.role, inv.cookbook_id, userId);
    db.prepare('UPDATE invites SET used = ? WHERE code_hash = ?').run(now(), inv.hash);
  }

  async function raw(req: IncomingMessage, limit: number): Promise<Buffer> {
    const declared = Number(req.headers['content-length'] || 0);
    if (declared > limit) throw new HttpError(413, 'too_large', 'Die Anfrage ist zu groß.');
    const chunks: Buffer[] = [];
    let size = 0;
    for await (const c of req) {
      size += (c as Buffer).length;
      if (size > limit) throw new HttpError(413, 'too_large', 'Die Anfrage ist zu groß.');
      chunks.push(c as Buffer);
    }
    return Buffer.concat(chunks);
  }

  async function body(req: IncomingMessage, limit: number): Promise<Record<string, unknown>> {
    const buf = await raw(req, limit);
    if (!buf.length) return {};
    if (!String(req.headers['content-type'] || '').startsWith('application/json')) throw new HttpError(400, 'bad_request', 'JSON erwartet.');
    try {
      const v = JSON.parse(buf.toString('utf8'));
      if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Error();
      return v;
    } catch {
      throw new HttpError(400, 'bad_request', 'Ungültiges JSON.');
    }
  }

  function json(res: ServerResponse, status: number, data: unknown): void {
    res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(JSON.stringify(data));
  }

  function cookbooksOf(userId: string) {
    return db
      .prepare('SELECT c.id, c.name, m.role FROM members m JOIN cookbooks c ON c.id = m.cookbook_id WHERE m.user_id = ? ORDER BY m.created')
      .all(userId) as { id: string; name: string; role: string }[];
  }

  const text = (v: unknown, max: number): string => (typeof v === 'string' ? v.trim().slice(0, max) : '');

  /** whether this user may write this record (readers only comment; comments only by their author or an owner) */
  function allowed(s: Session, r: string, store: string, data: unknown, old: { json: string; deleted: number } | undefined): boolean {
    if (store !== 'comments') return r === 'owner' || r === 'editor';
    const author = (x: unknown) => {
      const a = x && typeof x === 'object' ? (x as { author?: { id?: unknown } }).author : undefined;
      return a && typeof a.id === 'string' ? a.id : null;
    };
    if (old) {
      const was = author(JSON.parse(old.json));
      if (was !== s.userId && r !== 'owner') return false;
    }
    return data === null || author(data) === (old ? author(JSON.parse(old.json)) || s.userId : s.userId);
  }

  const routes: Record<string, (req: IncomingMessage, res: ServerResponse, url: URL) => Promise<void> | void> = {
    'GET /api/health': (_req, res) => json(res, 200, { ok: true }),

    // For Caddy forward_auth: 204 with a session; otherwise page requests are sent to the sign-in page, others get 401.
    'GET /api/auth/check': (req, res) => {
      if (session(req)) {
        res.writeHead(204, { 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      const uri = String(req.headers['x-forwarded-uri'] || '/');
      if (String(req.headers.accept || '').indexOf('text/html') >= 0) {
        res.writeHead(302, { Location: '/login/?next=' + encodeURIComponent(uri), 'Cache-Control': 'no-store' });
        res.end();
        return;
      }
      json(res, 401, { error: { code: 'unauthenticated', message: 'Bitte anmelden.' } });
    },

    'GET /api/me': (req, res) => {
      const s = requireSession(req);
      json(res, 200, { user: { id: s.userId, name: s.name }, cookbooks: cookbooksOf(s.userId), push_key: cfg.push ? cfg.push.publicKey : null });
    },

    'POST /api/me': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 4096);
      const name = text(b.name, 40);
      if (!name) throw new HttpError(400, 'bad_request', 'Bitte einen Namen angeben.');
      db.prepare('UPDATE users SET name = ? WHERE id = ?').run(name, s.userId);
      json(res, 200, { ok: true, name });
    },

    'POST /api/invites/info': async (req, res) => {
      const inv = validInvite((await body(req, 4096)).invite);
      const user = inv.user_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(inv.user_id) as { name: string }) : null;
      json(res, 200, { cookbook: inv.cookbook_name, name: user ? user.name : inv.name, role: inv.role, new_device: !!user });
    },

    // Signed-in users take an invite to another cookbook with their existing account
    'POST /api/invites/accept': async (req, res) => {
      const s = requireSession(req);
      const inv = validInvite((await body(req, 4096)).invite);
      joinCookbook(s.userId, inv);
      audit('invite_accepted', s.userId, clientIp(req), inv.cookbook_id);
      json(res, 200, { ok: true, cookbook_id: inv.cookbook_id });
    },

    'POST /api/invites': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 4096);
      if (role(s.userId, b.cookbook) !== 'owner') throw new HttpError(403, 'forbidden', 'Nur wer das Kochbuch besitzt, kann einladen.');
      const r = typeof b.role === 'string' && ROLES.indexOf(b.role) >= 0 ? b.role : 'reader';
      const userId = typeof b.user_id === 'string' && b.user_id ? b.user_id : undefined;
      if (userId) role(userId, b.cookbook);
      const name = text(b.name, 40);
      if (!userId && !name) throw new HttpError(400, 'bad_request', 'Bitte einen Namen angeben.');
      const inv = createInvite(db, { cookbookId: b.cookbook as string, name, userId, role: r, createdBy: s.userId, now: now() });
      audit('invite_created', s.userId, clientIp(req), (b.cookbook as string) + ' ' + r);
      json(res, 200, { link: cfg.origins[0] + '/login/?invite=' + inv.code, expires: inv.expires });
    },

    'GET /api/members': (req, res, url) => {
      const s = requireSession(req);
      const cookbook = url.searchParams.get('cookbook');
      role(s.userId, cookbook);
      const rows = db
        .prepare('SELECT u.id, u.name, m.role, (SELECT max(last_used) FROM sessions x WHERE x.user_id = u.id) AS last_seen FROM members m JOIN users u ON u.id = m.user_id WHERE m.cookbook_id = ? AND u.disabled = 0 ORDER BY m.created')
        .all(cookbook);
      json(res, 200, { members: rows });
    },

    'POST /api/members/remove': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 4096);
      if (role(s.userId, b.cookbook) !== 'owner') throw new HttpError(403, 'forbidden', 'Nur wer das Kochbuch besitzt, kann Zugänge entfernen.');
      if (b.user_id === s.userId) throw new HttpError(400, 'bad_request', 'Den eigenen Zugang bitte nicht entfernen.');
      db.prepare('DELETE FROM members WHERE cookbook_id = ? AND user_id = ?').run(b.cookbook as string, String(b.user_id));
      audit('member_removed', s.userId, clientIp(req), String(b.user_id));
      json(res, 200, { ok: true });
    },

    'POST /api/auth/register/options': async (req, res) => {
      const b = await body(req, 64 * 1024);
      const inv = validInvite(b.invite);
      const userId = inv.user_id || randomUUID();
      const name = inv.user_id ? (db.prepare('SELECT name FROM users WHERE id = ?').get(userId) as { name: string }).name : inv.name || 'Gast';
      const c = newChallenge('register', inv.hash, userId);
      const existing = db.prepare('SELECT id FROM credentials WHERE user_id = ?').all(userId) as { id: string }[];
      json(res, 200, {
        challenge_id: c.id,
        name,
        cookbook: inv.cookbook_name,
        public_key: {
          challenge: c.challenge,
          rp: { id: cfg.rpId, name: cfg.rpName || 'Herdgang' },
          user: { id: b64url(Buffer.from(userId)), name, displayName: name },
          pubKeyCredParams: [
            { type: 'public-key', alg: -7 },
            { type: 'public-key', alg: -8 },
            { type: 'public-key', alg: -257 },
          ],
          authenticatorSelection: { residentKey: 'required', requireResidentKey: true, userVerification: 'required' },
          attestation: 'none',
          timeout: CHALLENGE_TTL,
          excludeCredentials: existing.map((e) => ({ type: 'public-key', id: e.id })),
        },
      });
    },

    'POST /api/auth/register/verify': async (req, res) => {
      const ip = clientIp(req);
      if (limited(ip)) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte später noch einmal.');
      const b = await body(req, 64 * 1024);
      const ch = takeChallenge(b.challenge_id, 'register');
      const inv = validInvite(b.invite);
      if (inv.hash !== ch.invite_hash || !ch.userId) throw new HttpError(400, 'bad_request', 'Einladung passt nicht zur Challenge.');
      const cred = b.credential as { clientDataJSON?: string; attestationObject?: string } | undefined;
      let v;
      try {
        v = verifyRegistration({ clientDataJSON: String(cred && cred.clientDataJSON), attestationObject: String(cred && cred.attestationObject) }, {
          challenge: ch.challenge,
          origins: cfg.origins,
          rpId: cfg.rpId,
        });
      } catch (err) {
        fail(ip);
        audit('register_fail', inv.user_id, ip, (err as Error).message);
        throw new HttpError(401, 'passkey_rejected', 'Der Passkey konnte nicht eingerichtet werden.');
      }
      const userId = ch.userId;
      db.exec('BEGIN');
      try {
        if (!inv.user_id) db.prepare('INSERT INTO users (id, name, created) VALUES (?, ?, ?)').run(userId, inv.name || 'Gast', now());
        db.prepare('INSERT INTO credentials (id, user_id, jwk, alg, sign_count, label, created) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
          v.credentialId,
          userId,
          JSON.stringify(v.jwk),
          v.alg,
          v.signCount,
          text(b.label, 80) || null,
          now(),
        );
        joinCookbook(userId, inv);
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      audit('register_ok', userId, ip, v.credentialId.slice(0, 12));
      startSession(res, userId, req);
      json(res, 200, { ok: true, cookbook_id: inv.cookbook_id });
    },

    'POST /api/auth/login/options': (_req, res) => {
      const c = newChallenge('login', null);
      json(res, 200, {
        challenge_id: c.id,
        public_key: { challenge: c.challenge, rpId: cfg.rpId, userVerification: 'required', timeout: CHALLENGE_TTL, allowCredentials: [] },
      });
    },

    'POST /api/auth/login/verify': async (req, res) => {
      const ip = clientIp(req);
      if (limited(ip)) throw new HttpError(429, 'rate_limited', 'Zu viele Versuche. Bitte später noch einmal.');
      const b = await body(req, 64 * 1024);
      const ch = takeChallenge(b.challenge_id, 'login');
      const cred = (b.credential || {}) as { id?: string; clientDataJSON?: string; authenticatorData?: string; signature?: string };
      const row = db
        .prepare('SELECT c.*, u.disabled FROM credentials c JOIN users u ON u.id = c.user_id WHERE c.id = ?')
        .get(String(cred.id || '')) as { id: string; user_id: string; jwk: string; alg: number; sign_count: number; disabled: number } | undefined;
      try {
        if (!row || row.disabled) throw new Error('unknown passkey');
        const count = verifyAssertion(
          { clientDataJSON: String(cred.clientDataJSON), authenticatorData: String(cred.authenticatorData), signature: String(cred.signature) },
          { jwk: JSON.parse(row.jwk), alg: row.alg, signCount: row.sign_count },
          { challenge: ch.challenge, origins: cfg.origins, rpId: cfg.rpId },
        );
        db.prepare('UPDATE credentials SET sign_count = ?, last_used = ? WHERE id = ?').run(count, now(), row.id);
      } catch (err) {
        fail(ip);
        audit('login_fail', row ? row.user_id : null, ip, (err as Error).message);
        throw new HttpError(401, 'passkey_rejected', 'Die Anmeldung hat nicht geklappt.');
      }
      audit('login_ok', row.user_id, ip);
      startSession(res, row.user_id, req);
      json(res, 200, { ok: true });
    },

    'POST /api/auth/logout': (req, res) => {
      const s = session(req);
      if (s) {
        db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(s.hash);
        audit('logout', s.userId, clientIp(req));
      }
      res.setHeader('Set-Cookie', `${SESSION_COOKIE}=; HttpOnly; Secure; SameSite=Lax; Path=/; Max-Age=0`);
      json(res, 200, { ok: true });
    },

    // Sync: records since a cursor (time of arrival at the server), or upload. The newer change wins.
    'GET /api/records': (req, res, url) => {
      const s = requireSession(req);
      const cookbook = url.searchParams.get('cookbook');
      role(s.userId, cookbook);
      const since = Number(url.searchParams.get('since') || 0) || 0;
      const rows = db
        .prepare('SELECT store, id, json, updated, deleted, received FROM records WHERE cookbook_id = ? AND received > ? ORDER BY received LIMIT 2001')
        .all(cookbook, since) as { store: string; id: string; json: string; updated: number; deleted: number; received: number }[];
      const more = rows.length > 2000;
      const page = rows.slice(0, 2000);
      json(res, 200, {
        records: page.map((r) => ({ store: r.store, id: r.id, updated: r.updated, deleted: !!r.deleted, data: JSON.parse(r.json) })),
        cursor: page.length ? page[page.length - 1].received : since,
        more,
      });
    },

    'POST /api/records': async (req, res, url) => {
      const s = requireSession(req);
      const cookbook = url.searchParams.get('cookbook') as string;
      const r = role(s.userId, cookbook);
      const b = await body(req, 8 * 1024 * 1024);
      const list = b.records;
      if (!Array.isArray(list) || list.length > 5000) throw new HttpError(400, 'bad_request', 'records fehlt oder zu viele.');
      let accepted = 0;
      let rejected = 0;
      const get = db.prepare('SELECT json, updated, deleted FROM records WHERE cookbook_id = ? AND store = ? AND id = ?');
      const put = db.prepare(
        'INSERT INTO records (cookbook_id, store, id, json, updated, received, deleted) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT (cookbook_id, store, id) DO UPDATE SET json = excluded.json, updated = excluded.updated, received = excluded.received, deleted = excluded.deleted',
      );
      db.exec('BEGIN');
      try {
        let received = nextReceived(db, now());
        for (const rec of list as { store?: unknown; id?: unknown; updated?: unknown; deleted?: unknown; data?: unknown }[]) {
          if (!rec || typeof rec.store !== 'string' || STORES.indexOf(rec.store) < 0 || typeof rec.id !== 'string' || !rec.id || rec.id.length > 100) {
            throw new HttpError(400, 'bad_request', 'Ungültiger Datensatz.');
          }
          const data = rec.deleted ? null : rec.data === undefined ? null : rec.data;
          const serial = JSON.stringify(data);
          if (serial.length > 256 * 1024) throw new HttpError(413, 'too_large', 'Datensatz zu groß.');
          const updated = Number(rec.updated) || 0;
          const old = get.get(cookbook, rec.store, rec.id) as { json: string; updated: number; deleted: number } | undefined;
          if (old && old.updated > updated) continue;
          // revisions are immutable, like commits
          if (rec.store === 'revisions' && old && !old.deleted && old.json !== serial) {
            rejected++;
            continue;
          }
          if (!allowed(s, r, rec.store, data, old)) {
            rejected++;
            continue;
          }
          if (old && old.json === serial && !!old.deleted === !!rec.deleted) continue;
          put.run(cookbook, rec.store, rec.id, serial, updated, received++, rec.deleted ? 1 : 0);
          accepted++;
        }
        db.exec('COMMIT');
      } catch (err) {
        db.exec('ROLLBACK');
        throw err;
      }
      if (rejected) audit('records_rejected', s.userId, clientIp(req), String(rejected));
      json(res, 200, { accepted, rejected });
    },

    'POST /api/push/subscribe': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 8192);
      const sub = (b.subscription || {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
      const endpoint = typeof sub.endpoint === 'string' && /^https:\/\//.test(sub.endpoint) ? sub.endpoint : '';
      const keys = sub.keys || {};
      if (!endpoint || typeof keys.p256dh !== 'string' || typeof keys.auth !== 'string') throw new HttpError(400, 'bad_request', 'Ungültiges Abo.');
      db.prepare(
        'INSERT INTO push_subscriptions (endpoint, user_id, p256dh, auth, created) VALUES (?, ?, ?, ?, ?) ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth',
      ).run(endpoint, s.userId, keys.p256dh, keys.auth, now());
      json(res, 200, { ok: true });
    },

    // A running kitchen timer: at `due` the server sends a push message to the device that started it
    'POST /api/timers': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 8192);
      const id = text(b.id, 64);
      const due = Number(b.due);
      const endpoint = typeof b.endpoint === 'string' ? b.endpoint : '';
      if (!id || !isFinite(due) || due < now() - 60000 || due > now() + 2 * 86400000) throw new HttpError(400, 'bad_request', 'Ungültiger Timer.');
      const sub = db.prepare('SELECT endpoint FROM push_subscriptions WHERE endpoint = ? AND user_id = ?').get(endpoint, s.userId);
      if (!sub) throw new HttpError(404, 'no_subscription', 'Benachrichtigungen sind auf diesem Gerät nicht eingerichtet.');
      const payload = { type: 'timer', id, title: text(b.title, 120), body: text(b.body, 300), url: text(b.url, 300) };
      db.prepare('INSERT INTO timers (id, user_id, endpoint, due, payload, created) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET due = excluded.due, payload = excluded.payload, endpoint = excluded.endpoint').run(
        id,
        s.userId,
        endpoint,
        due,
        JSON.stringify(payload),
        now(),
      );
      json(res, 200, { ok: true });
    },

    'POST /api/timers/cancel': async (req, res) => {
      const s = requireSession(req);
      const b = await body(req, 4096);
      db.prepare('DELETE FROM timers WHERE id = ? AND user_id = ?').run(text(b.id, 64), s.userId);
      json(res, 200, { ok: true });
    },
  };

  /** sends due timer notifications; returns how many went out */
  async function tick(): Promise<number> {
    if (!cfg.push) return 0;
    const due = db
      .prepare('SELECT t.id, t.payload, s.endpoint, s.p256dh, s.auth FROM timers t JOIN push_subscriptions s ON s.endpoint = t.endpoint WHERE t.due <= ?')
      .all(now()) as unknown as (Subscription & { id: string; payload: string })[];
    db.prepare('DELETE FROM timers WHERE due <= ?').run(now());
    let sent = 0;
    for (const t of due) {
      try {
        const status = await cfg.push.send(t, JSON.parse(t.payload));
        if (status === 404 || status === 410) db.prepare('DELETE FROM push_subscriptions WHERE endpoint = ?').run(t.endpoint);
        else if (status < 300) sent++;
        else console.error('push failed', status);
      } catch (err) {
        console.error('push failed', (err as Error).message);
      }
    }
    return sent;
  }

  const TYPES: Record<string, string> = {
    '.html': 'text/html; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.json': 'application/json',
    '.webmanifest': 'application/manifest+json',
    '.txt': 'text/plain; charset=utf-8',
  };

  async function serveStatic(req: IncomingMessage, res: ServerResponse, url: URL): Promise<void> {
    const base = resolve(cfg.staticDir as string);
    const path = decodeURIComponent(url.pathname);
    if (!PUBLIC_PATHS.test(path) && !session(req)) {
      if (String(req.headers.accept || '').indexOf('text/html') >= 0) {
        res.writeHead(302, { Location: '/login/?next=' + encodeURIComponent(url.pathname + url.search) });
        res.end();
      } else json(res, 401, { error: { code: 'unauthenticated', message: 'Bitte anmelden.' } });
      return;
    }
    let file = resolve(join(base, path));
    if (file !== base && !file.startsWith(base + sep)) throw new HttpError(404, 'not_found', 'Nicht gefunden.');
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const data = await readFile(file);
      res.writeHead(200, { 'Content-Type': TYPES[extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'Content-Security-Policy': CSP });
      res.end(data);
    } catch {
      throw new HttpError(404, 'not_found', 'Nicht gefunden.');
    }
  }

  async function handle(req: IncomingMessage, res: ServerResponse): Promise<void> {
    try {
      const url = new URL(req.url || '/', 'http://local');
      const method = req.method === 'HEAD' ? 'GET' : req.method || 'GET';
      if (method !== 'GET') {
        const origin = String(req.headers.origin || '');
        if (cfg.origins.indexOf(origin) < 0) throw new HttpError(403, 'bad_origin', 'Anfrage von fremder Adresse.');
      }
      const route = routes[method + ' ' + url.pathname];
      if (route) return await route(req, res, url);
      if (url.pathname.startsWith('/api/')) throw new HttpError(404, 'not_found', 'Nicht gefunden.');
      if (cfg.staticDir && method === 'GET') return await serveStatic(req, res, url);
      throw new HttpError(404, 'not_found', 'Nicht gefunden.');
    } catch (err) {
      if (err instanceof HttpError) return json(res, err.status, { error: { code: err.code, message: err.message } });
      console.error(err);
      json(res, 500, { error: { code: 'internal', message: 'Unerwarteter Fehler.' } });
    }
  }

  return { handle, tick };
}

/** creates a cookbook (name must be unique) */
export function createCookbook(db: DatabaseSync, name: string, now = Date.now()): string {
  if (db.prepare('SELECT id FROM cookbooks WHERE name = ?').get(name)) throw new Error('Cookbook exists: ' + name);
  const id = randomUUID();
  db.prepare('INSERT INTO cookbooks (id, name, created) VALUES (?, ?, ?)').run(id, name, now);
  return id;
}

/**
 * Creates an invite (128 bit, single use, 14 days by default). With a name it creates a new person; with userId it adds a
 * device (passkey) for an existing person. Either way the person joins the cookbook with the given role.
 */
export function createInvite(
  db: DatabaseSync,
  opts: { cookbookId: string; name?: string; userId?: string; role?: string; days?: number; createdBy?: string; now?: number },
): { code: string; expires: number } {
  const t = opts.now || Date.now();
  if (!db.prepare('SELECT id FROM cookbooks WHERE id = ?').get(opts.cookbookId)) throw new Error('Cookbook not found: ' + opts.cookbookId);
  if (opts.userId && !db.prepare('SELECT id FROM users WHERE id = ?').get(opts.userId)) throw new Error('User not found: ' + opts.userId);
  const r = opts.role || 'reader';
  if (ROLES.indexOf(r) < 0) throw new Error('Unknown role: ' + r);
  const code = b64url(randomBytes(16));
  const expires = t + (opts.days || 14) * 86400000;
  db.prepare('INSERT INTO invites (code_hash, cookbook_id, role, name, user_id, created_by, created, expires) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    sha256hex(code),
    opts.cookbookId,
    r,
    opts.userId ? null : opts.name || null,
    opts.userId || null,
    opts.createdBy || null,
    t,
    expires,
  );
  db.prepare('INSERT INTO audit (time, user_id, event, detail) VALUES (?, ?, ?, ?)').run(t, opts.createdBy || null, 'invite_created', opts.cookbookId);
  return { code, expires };
}
