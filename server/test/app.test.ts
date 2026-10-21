import assert from 'node:assert/strict';
import { createDecipheriv, createECDH, hkdfSync, randomBytes, verify, createPublicKey } from 'node:crypto';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, test } from 'node:test';
import { createApp, createCookbook, createInvite, SESSION_COOKIE } from '../app.ts';
import { commit, context, entries, find } from '../cookbook.ts';
import { openDb } from '../db.ts';
import { encrypt, vapidHeader, vapidKeys, type Subscription } from '../push.ts';
import { SoftAuthenticator } from './authenticator.ts';

const ORIGIN = 'https://herdgang.example.org';
const RP = 'herdgang.example.org';
let server: Server;
let base = '';
let clock = Date.parse('2026-10-21T10:00:00Z');
const db = openDb(':memory:');
const pushed: { sub: Subscription; payload: unknown }[] = [];
const app = createApp({
  db,
  origins: [ORIGIN],
  rpId: RP,
  now: () => clock,
  push: { publicKey: 'test', send: async (sub, payload) => (pushed.push({ sub, payload }), 201) },
});
const BOOK = createCookbook(db, 'Daniels Kochbuch');
const OTHER = createCookbook(db, 'Nachbarn');

before(async () => {
  server = createServer((req, res) => void app.handle(req, res));
  await new Promise<void>((r) => server.listen(0, '127.0.0.1', () => r()));
  base = 'http://127.0.0.1:' + (server.address() as AddressInfo).port;
});
after(() => server.close());

async function call(path: string, body?: unknown, cookie?: string, origin = ORIGIN) {
  const res = await fetch(base + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { ...(body === undefined ? {} : { 'Content-Type': 'application/json', Origin: origin }), ...(cookie ? { Cookie: cookie } : {}), Accept: 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    redirect: 'manual',
  });
  const set = res.headers.get('set-cookie') || '';
  const m = new RegExp(SESSION_COOKIE + '=([^;]*)').exec(set);
  const text = await res.text();
  return { status: res.status, data: text ? JSON.parse(text) : null, cookie: m && m[1] ? `${SESSION_COOKIE}=${m[1]}` : undefined, headers: res.headers };
}

async function register(dev: SoftAuthenticator, code: string) {
  const o = await call('/api/auth/register/options', { invite: code });
  assert.equal(o.status, 200, JSON.stringify(o.data));
  const cred = dev.register({ challenge: o.data.public_key.challenge, origin: ORIGIN, rpId: RP });
  return call('/api/auth/register/verify', { invite: code, challenge_id: o.data.challenge_id, credential: cred });
}

async function login(dev: SoftAuthenticator) {
  const o = await call('/api/auth/login/options', {});
  const cred = dev.login({ challenge: o.data.public_key.challenge, origin: ORIGIN, rpId: RP });
  return call('/api/auth/login/verify', { challenge_id: o.data.challenge_id, credential: cred });
}

async function person(name: string, cookbookId: string, role: string) {
  const dev = new SoftAuthenticator();
  const r = await register(dev, createInvite(db, { cookbookId, name, role }).code);
  assert.equal(r.status, 200);
  const me = await call('/api/me', undefined, r.cookie);
  return { dev, cookie: r.cookie as string, id: me.data.user.id as string };
}

test('invite → passkey → session → logout → sign in again', async () => {
  const { code } = createInvite(db, { cookbookId: BOOK, name: 'Daniel', role: 'owner' });
  const info = await call('/api/invites/info', { invite: code });
  assert.deepEqual(info.data, { cookbook: 'Daniels Kochbuch', name: 'Daniel', role: 'owner', new_device: false });
  const dev = new SoftAuthenticator();
  const r = await register(dev, code);
  assert.equal(r.status, 200);
  const me = await call('/api/me', undefined, r.cookie);
  assert.equal(me.data.user.name, 'Daniel');
  assert.deepEqual(me.data.cookbooks, [{ id: BOOK, name: 'Daniels Kochbuch', role: 'owner' }]);
  assert.equal((await call('/api/auth/check', undefined, r.cookie)).status, 204);
  await call('/api/auth/logout', {}, r.cookie);
  assert.equal((await call('/api/me', undefined, r.cookie)).status, 401);
  const l = await login(dev);
  assert.equal(l.status, 200);
  assert.equal((await call('/api/me', undefined, l.cookie)).data.user.name, 'Daniel');
  assert.equal((await call('/api/auth/register/options', { invite: code })).data.error.code, 'invite_invalid');
  // second device for the same person
  const second = createInvite(db, { cookbookId: BOOK, userId: me.data.user.id });
  assert.equal((await call('/api/invites/info', { invite: second.code })).data.new_device, true);
  const tablet = new SoftAuthenticator('ed25519');
  const t = await register(tablet, second.code);
  assert.equal((await call('/api/me', undefined, t.cookie)).data.user.id, me.data.user.id);
  assert.equal((await call('/api/me', undefined, t.cookie)).data.cookbooks[0].role, 'owner');
});

test('attacks are rejected', async () => {
  const { dev } = await person('Ziel', BOOK, 'reader');
  const other = new SoftAuthenticator();
  other.credentialId = dev.credentialId;
  assert.equal((await login(other)).data.error.code, 'passkey_rejected');
  const o = await call('/api/auth/login/options', {});
  const wrong = dev.login({ challenge: o.data.public_key.challenge, origin: 'https://evil.example', rpId: RP });
  assert.equal((await call('/api/auth/login/verify', { challenge_id: o.data.challenge_id, credential: wrong })).status, 401);
  const o2 = await call('/api/auth/login/options', {});
  const ok = dev.login({ challenge: o2.data.public_key.challenge, origin: ORIGIN, rpId: RP });
  assert.equal((await call('/api/auth/login/verify', { challenge_id: o2.data.challenge_id, credential: ok })).status, 200);
  assert.equal((await call('/api/auth/login/verify', { challenge_id: o2.data.challenge_id, credential: ok })).data.error.code, 'challenge_expired');
  dev.flags = 0x01;
  assert.equal((await login(dev)).status, 401);
  assert.equal((await call('/api/auth/login/options', {}, undefined, 'https://evil.example')).data.error.code, 'bad_origin');
  const page = await fetch(base + '/api/auth/check', { headers: { Accept: 'text/html', 'X-Forwarded-Uri': '/#/r/x' }, redirect: 'manual' });
  assert.equal(page.status, 302);
  assert.equal(page.headers.get('location'), '/login/?next=%2F%23%2Fr%2Fx');
  // expired invite
  const old = createInvite(db, { cookbookId: BOOK, name: 'Spät', now: clock - 15 * 86400000 });
  assert.equal((await call('/api/auth/register/options', { invite: old.code })).data.error.code, 'invite_invalid');
});

const rev = (id: string, recipeId: string, source: string, author: { id: string; name: string }) => ({
  store: 'revisions',
  id,
  updated: clock,
  data: { id, recipeId, parentId: null, source, message: 'Erste Fassung', author, created: clock },
});

test('cookbooks are separate, roles decide who may write what', async () => {
  const owner = await person('Mama', BOOK, 'editor');
  const kid = await person('Ben', BOOK, 'reader');
  const neighbour = await person('Nachbar', OTHER, 'owner');
  const recipe = { store: 'recipes', id: 'r1', updated: clock, data: { id: 'r1', created: clock, createdBy: { id: owner.id, name: 'Mama' } } };
  const up = await call('/api/records?cookbook=' + BOOK, { records: [recipe, rev('v1', 'r1', '# Test\n\nRühren.\n', { id: owner.id, name: 'Mama' })] }, owner.cookie);
  assert.deepEqual(up.data, { accepted: 2, rejected: 0 });
  // the neighbour sees nothing of this cookbook and cannot write into it
  assert.equal((await call('/api/records?cookbook=' + BOOK, undefined, neighbour.cookie)).status, 403);
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [recipe] }, neighbour.cookie)).status, 403);
  assert.equal((await call('/api/records?cookbook=' + OTHER, undefined, neighbour.cookie)).data.records.length, 0);
  // a reader cannot change recipes but can comment
  const kidRev = rev('v2', 'r1', '# Test\n\nViel Zucker.\n', { id: kid.id, name: 'Ben' });
  assert.deepEqual((await call('/api/records?cookbook=' + BOOK, { records: [kidRev] }, kid.cookie)).data, { accepted: 0, rejected: 1 });
  const comment = { store: 'comments', id: 'c1', updated: clock, data: { id: 'c1', recipeId: 'r1', revisionId: 'v1', text: 'Lecker', author: { id: kid.id, name: 'Ben' }, created: clock } };
  assert.deepEqual((await call('/api/records?cookbook=' + BOOK, { records: [comment] }, kid.cookie)).data, { accepted: 1, rejected: 0 });
  // nobody writes comments in someone else's name, and only the author (or an owner) edits or deletes them
  const fake = { ...comment, id: 'c2', data: { ...comment.data, id: 'c2', author: { id: owner.id, name: 'Mama' } } };
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [fake] }, kid.cookie)).data.rejected, 1);
  clock += 1000;
  const edit = { ...comment, updated: clock, data: { ...comment.data, text: 'Sehr lecker', edited: clock } };
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [edit] }, owner.cookie)).data.rejected, 1);
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [edit] }, kid.cookie)).data.accepted, 1);
  clock += 1000;
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [{ store: 'comments', id: 'c1', updated: clock, deleted: true }] }, kid.cookie)).data.accepted, 1);
  // revisions are immutable
  clock += 1000;
  const changed = rev('v1', 'r1', '# Test\n\nAnders.\n', { id: owner.id, name: 'Mama' });
  changed.updated = clock;
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [changed] }, owner.cookie)).data.rejected, 1);
  // which food an ingredient counts as: editors decide, readers do not
  const food = { store: 'foods', id: 'butter', updated: clock, data: { id: 'butter', name: 'Butter', code: 'Q630000', author: { id: kid.id, name: 'Ben' }, created: clock } };
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [food] }, kid.cookie)).data.rejected, 1);
  assert.equal((await call('/api/records?cookbook=' + BOOK, { records: [food] }, owner.cookie)).data.accepted, 1);
  const all = await call('/api/records?cookbook=' + BOOK, undefined, kid.cookie);
  assert.deepEqual(all.data.records.map((r: { id: string; deleted: boolean }) => r.id + (r.deleted ? '†' : '')).sort(), ['butter', 'c1†', 'r1', 'v1']);
});

test('invites from the app: owners only; joining another cookbook keeps the account', async () => {
  const owner = await person('Oma', OTHER, 'owner');
  const reader = await person('Leser', BOOK, 'reader');
  assert.equal((await call('/api/invites', { cookbook: BOOK, name: 'X' }, reader.cookie)).status, 403);
  const inv = await call('/api/invites', { cookbook: OTHER, name: 'Leser', role: 'editor' }, owner.cookie);
  assert.equal(inv.status, 200);
  const code = new URL(inv.data.link).searchParams.get('invite') as string;
  assert.ok(inv.data.link.startsWith(ORIGIN + '/login/?invite='));
  assert.equal((await call('/api/invites/accept', { invite: code }, reader.cookie)).status, 200);
  const me = await call('/api/me', undefined, reader.cookie);
  assert.deepEqual(me.data.cookbooks.map((c: { name: string; role: string }) => c.name + ':' + c.role), ['Daniels Kochbuch:reader', 'Nachbarn:editor']);
  const members = await call('/api/members?cookbook=' + OTHER, undefined, owner.cookie);
  assert.ok(members.data.members.some((m: { name: string }) => m.name === 'Leser'));
  assert.equal((await call('/api/members/remove', { cookbook: OTHER, user_id: reader.id }, owner.cookie)).status, 200);
  assert.equal((await call('/api/records?cookbook=' + OTHER, undefined, reader.cookie)).status, 403);
  assert.equal((await call('/api/me', { name: '  Ben  ' }, reader.cookie)).data.name, 'Ben');
});

test('timers: push to the device that started them, cancel works', async () => {
  const p = await person('Koch', BOOK, 'reader');
  const sub = { endpoint: 'https://push.example.org/abc', keys: { p256dh: 'x', auth: 'y' } };
  assert.equal((await call('/api/timers', { id: 't1', due: clock + 60000, endpoint: sub.endpoint }, p.cookie)).data.error.code, 'no_subscription');
  assert.equal((await call('/api/push/subscribe', { subscription: sub }, p.cookie)).status, 200);
  assert.equal((await call('/api/timers', { id: 't1', due: clock + 60000, endpoint: sub.endpoint, title: 'Brot aus dem Ofen nehmen', body: 'Bauernbrot' }, p.cookie)).status, 200);
  assert.equal((await call('/api/timers', { id: 't2', due: clock + 120000, endpoint: sub.endpoint, title: 'Zweiter' }, p.cookie)).status, 200);
  assert.equal(await app.tick(), 0);
  clock += 61000;
  assert.equal(await app.tick(), 1);
  assert.deepEqual(pushed[0].payload, { type: 'timer', id: 't1', title: 'Brot aus dem Ofen nehmen', body: 'Bauernbrot', url: '' });
  assert.equal(await app.tick(), 0);
  assert.equal((await call('/api/timers/cancel', { id: 't2' }, p.cookie)).status, 200);
  clock += 120000;
  assert.equal(await app.tick(), 0);
});

test('push messages decrypt like a browser would (RFC 8291) and carry a valid VAPID signature', () => {
  const ua = createECDH('prime256v1');
  ua.generateKeys();
  const auth = randomBytes(16);
  const sub = { p256dh: ua.getPublicKey().toString('base64url'), auth: auth.toString('base64url') };
  const msg = encrypt(Buffer.from('{"title":"Brot raus"}'), sub);
  const salt = msg.subarray(0, 16);
  const idlen = msg[20];
  const asPublic = msg.subarray(21, 21 + idlen);
  const body = msg.subarray(21 + idlen);
  const shared = ua.computeSecret(asPublic);
  const ikm = Buffer.from(hkdfSync('sha256', shared, auth, Buffer.concat([Buffer.from('WebPush: info\0'), ua.getPublicKey(), asPublic]), 32));
  const cek = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: aes128gcm\0'), 16));
  const nonce = Buffer.from(hkdfSync('sha256', ikm, salt, Buffer.from('Content-Encoding: nonce\0'), 12));
  const d = createDecipheriv('aes-128-gcm', cek, nonce);
  d.setAuthTag(body.subarray(body.length - 16));
  const plain = Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]);
  assert.equal(plain.subarray(0, plain.length - 1).toString(), '{"title":"Brot raus"}');
  assert.equal(plain[plain.length - 1], 2);

  const v = vapidKeys(openDb(':memory:'));
  const h = vapidHeader(v, 'https://fcm.googleapis.com/fcm/send/abc', 'https://herdgang.example.org', Date.parse('2026-10-21T10:00:00Z'));
  const m = /^vapid t=([^.]+)\.([^.]+)\.([^,]+), k=(.+)$/.exec(h) as RegExpExecArray;
  assert.deepEqual(JSON.parse(Buffer.from(m[2], 'base64url').toString()), { aud: 'https://fcm.googleapis.com', exp: Math.floor(Date.parse('2026-10-21T10:00:00Z') / 1000) + 43200, sub: 'https://herdgang.example.org' });
  const pub = Buffer.from(m[4], 'base64url');
  const key = createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: pub.subarray(1, 33).toString('base64url'), y: pub.subarray(33).toString('base64url') }, format: 'jwk' });
  assert.ok(verify('sha256', Buffer.from(m[1] + '.' + m[2]), { key, dsaEncoding: 'ieee-p1363' }, Buffer.from(m[3], 'base64url')));
});

test('command line: commit guards against stale versions, context lists feedback by version', () => {
  const book = createCookbook(db, 'CLI');
  const a = { id: 'cli', name: 'Daniel' };
  const one = commit(db, book, { source: '# Pfannkuchen\n\n- 250 g Mehl\nRühren.\n', message: 'Erste Fassung', author: a, now: 1000 });
  assert.equal(one.version, 1);
  assert.throws(() => commit(db, book, { recipeId: one.recipeId, source: '# Pfannkuchen\n\n- 250 g Mehl\nRühren.\n', message: 'x', author: a }), /No change/);
  assert.throws(() => commit(db, book, { recipeId: one.recipeId, source: '# Pfannkuchen\n\nKaputt [x]{\n', message: 'x', author: a }), /errors/);
  const two = commit(db, book, { recipeId: one.recipeId, source: '# Pfannkuchen\n\n- 260 g Mehl\nRühren.\n', message: 'Mehr Mehl', author: a, parent: 1, now: 2000 });
  assert.equal(two.version, 2);
  assert.throws(() => commit(db, book, { recipeId: one.recipeId, source: '# Pfannkuchen\n\n- 270 g Mehl\nRühren.\n', message: 'Noch mehr', author: a, parent: 1 }), /Version 2 is current/);
  const e = find(db, book, 'pfannkuchen');
  assert.equal(e.revisions.length, 2);
  assert.equal(entries(db, book).length, 1);
  const ctx = context({ ...e, comments: [{ id: 'c', recipeId: one.recipeId, revisionId: one.revisionId, text: 'Zu fest', author: { id: 'u', name: 'Ben' }, created: 1500 }] });
  assert.match(ctx, /Version 2 · .* · Daniel: Mehr Mehl/);
  assert.match(ctx, /zu Version 1 · .* · Ben: Zu fest/);
  assert.match(ctx, /- 260 g Mehl/);
});
