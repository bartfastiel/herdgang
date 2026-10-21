// Herdgang backend: sign-in, sessions, sync, invites, timer notifications. Runs behind Caddy.
//
// Environment:
//   ORIGIN        allowed address(es), comma separated; the first is the main address (passkey RP ID = its host name)
//   DATA_DIR      directory for herdgang.db (default ./data)
//   PORT          default 8080
//   TRUST_PROXY   1 = client IP from the last X-Forwarded-For entry (behind Caddy)
//   PUSH          0 = no timer notifications (tests)
//   STATIC_DIR    development and tests only: serve dist/ with the same access check as Caddy
import { mkdirSync } from 'node:fs';
import { createServer } from 'node:http';
import { join } from 'node:path';
import { createApp } from './app.ts';
import { openDb } from './db.ts';
import { createSender, vapidKeys } from './push.ts';

const origins = (process.env.ORIGIN || 'http://localhost:8080').split(',').map((s) => s.trim()).filter(Boolean);
const dataDir = process.env.DATA_DIR || 'data';
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'herdgang.db'));
const vapid = vapidKeys(db);
const app = createApp({
  db,
  origins,
  rpId: new URL(origins[0]).hostname,
  trustProxy: process.env.TRUST_PROXY === '1',
  staticDir: process.env.STATIC_DIR || undefined,
  push: process.env.PUSH === '0' ? undefined : { publicKey: vapid.publicKey, send: createSender(vapid, origins[0]) },
});
const port = Number(process.env.PORT || 8080);
const server = createServer((req, res) => void app.handle(req, res));
server.listen(port, () => console.log(`Herdgang backend on :${port}, origin ${origins.join(', ')}`));
let busy = false;
const timer = setInterval(() => {
  if (busy) return;
  busy = true;
  app.tick().finally(() => (busy = false));
}, 1000);
const stop = () => (clearInterval(timer), server.close(() => (db.close(), process.exit(0))));
process.on('SIGTERM', stop);
process.on('SIGINT', stop);
