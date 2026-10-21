// Serves the built app (dist/), the stage (tools/video/stage/ under /__stage/) and prepared media (.local/video/ under
// /__media/) for the explainer video, plus a show API in memory: the recipes of the local cookbook (.local/data, filled
// with `cli.mjs import`), Daniel as owner. Nothing the video does is stored, nothing leaves the computer.
import { randomBytes } from 'node:crypto';
import { readFile, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type Server } from 'node:http';
import { extname, join, resolve, sep } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { CSP } from '../serve.mjs';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.webmanifest': 'application/manifest+json',
  '.json': 'application/json',
};

const APP_CSP = CSP.replace("frame-ancestors 'none'", "frame-ancestors 'self'");

function body(req: IncomingMessage): Promise<Buffer> {
  return new Promise((ok) => {
    const parts: Buffer[] = [];
    req.on('data', (c: Buffer) => parts.push(c));
    req.on('end', () => ok(Buffer.concat(parts)));
  });
}

export function host(port: number): Promise<Server> {
  const roots = { app: resolve('dist'), stage: resolve('tools/video/stage'), media: resolve('.local/video') };
  const db = new DatabaseSync('.local/data/herdgang.db', { readOnly: true });
  const book = db.prepare('SELECT id, name FROM cookbooks ORDER BY created LIMIT 1').get() as { id: string; name: string };
  let received = 0;
  const records = (db.prepare('SELECT store, id, json, updated FROM records WHERE cookbook_id = ? AND deleted = 0 ORDER BY received').all(book.id) as {
    store: string;
    id: string;
    json: string;
    updated: number;
  }[]).map((r) => ({ store: r.store, id: r.id, updated: r.updated, deleted: false, data: JSON.parse(r.json), received: ++received }));
  db.close();
  const appHost = process.env.HERDGANG_HOST || 'herdgang.example';

  const server = createServer(async (req, res) => {
    const url = new URL(req.url || '/', 'http://local');
    const path = decodeURIComponent(url.pathname);
    if (path.startsWith('/api/')) {
      const json = (v: unknown, status = 200) => void res.writeHead(status, { 'Content-Type': 'application/json' }).end(JSON.stringify(v));
      const m = req.method || 'GET';
      if (path === '/api/me') return json({ user: { id: 'daniel', name: 'Daniel' }, cookbooks: [{ id: book.id, name: book.name, role: 'owner' }], push_key: null });
      if (path === '/api/records' && m === 'POST') {
        const b = JSON.parse((await body(req)).toString()) as { records: { store: string; id: string; updated: number; deleted?: boolean; data: unknown }[] };
        for (const r of b.records) records.push({ store: r.store, id: r.id, updated: r.updated, deleted: !!r.deleted, data: r.data, received: ++received });
        return json({ accepted: b.records.length, rejected: 0 });
      }
      if (path === '/api/records') {
        const since = Number(url.searchParams.get('since') || 0);
        return json({ records: records.filter((r) => r.received > since), cursor: received, more: false });
      }
      if (path === '/api/invites' && m === 'POST') {
        await body(req);
        return json({ link: `https://${appHost}/login/?invite=${randomBytes(16).toString('base64url')}`, expires: Date.now() + 14 * 86400000 });
      }
      if (path === '/api/members') return json({ members: [{ id: 'daniel', name: 'Daniel', role: 'owner', last_seen: Date.now() }] });
      return json({ error: { code: 'not_found', message: 'nicht vorhanden' } }, 404);
    }
    const kind = path.startsWith('/__stage/') ? 'stage' : path.startsWith('/__media/') ? 'media' : 'app';
    const base = roots[kind];
    let file = resolve(join(base, kind === 'app' ? path : path.slice(path.indexOf('/', 2))));
    if (file !== base && !file.startsWith(base + sep)) return void res.writeHead(403).end();
    try {
      if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
      const content = await readFile(file);
      const headers: Record<string, string> = { 'Content-Type': TYPES[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-cache' };
      if (kind === 'app') headers['Content-Security-Policy'] = APP_CSP;
      res.writeHead(200, headers).end(content);
    } catch {
      res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404');
    }
  });
  return new Promise((ok) => server.listen(port, '127.0.0.1', () => ok(server)));
}
