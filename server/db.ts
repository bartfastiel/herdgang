// Database (node:sqlite): users with passkeys and sessions, cookbooks (the tenants) with members and invites, the records
// of each cookbook (recipes, revisions, comments), push subscriptions and pending timer alarms, and an audit log.
import { DatabaseSync } from 'node:sqlite';

const SCHEMA = [
  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created INTEGER NOT NULL,
    disabled INTEGER NOT NULL DEFAULT 0
  )`,
  `CREATE TABLE IF NOT EXISTS cookbooks (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  // role: owner (everything, invites), editor (recipes and comments), reader (read and comment)
  `CREATE TABLE IF NOT EXISTS members (
    cookbook_id TEXT NOT NULL REFERENCES cookbooks(id),
    user_id TEXT NOT NULL REFERENCES users(id),
    role TEXT NOT NULL,
    created INTEGER NOT NULL,
    PRIMARY KEY (cookbook_id, user_id)
  )`,
  `CREATE TABLE IF NOT EXISTS credentials (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    jwk TEXT NOT NULL,
    alg INTEGER NOT NULL,
    sign_count INTEGER NOT NULL,
    label TEXT,
    created INTEGER NOT NULL,
    last_used INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS sessions (
    token_hash TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    created INTEGER NOT NULL,
    last_used INTEGER NOT NULL,
    user_agent TEXT
  )`,
  // an invite either creates a new user (name) or adds a passkey to an existing one (user_id); both join the cookbook
  `CREATE TABLE IF NOT EXISTS invites (
    code_hash TEXT PRIMARY KEY,
    cookbook_id TEXT NOT NULL REFERENCES cookbooks(id),
    role TEXT NOT NULL,
    name TEXT,
    user_id TEXT REFERENCES users(id),
    created_by TEXT,
    created INTEGER NOT NULL,
    expires INTEGER NOT NULL,
    used INTEGER
  )`,
  `CREATE TABLE IF NOT EXISTS challenges (
    id TEXT PRIMARY KEY,
    challenge TEXT NOT NULL,
    kind TEXT NOT NULL,
    invite_hash TEXT,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS audit (
    time INTEGER NOT NULL,
    user_id TEXT,
    event TEXT NOT NULL,
    ip TEXT,
    detail TEXT
  )`,
  `CREATE TABLE IF NOT EXISTS records (
    cookbook_id TEXT NOT NULL REFERENCES cookbooks(id),
    store TEXT NOT NULL,
    id TEXT NOT NULL,
    json TEXT NOT NULL,
    updated INTEGER NOT NULL,
    received INTEGER NOT NULL,
    deleted INTEGER NOT NULL DEFAULT 0,
    PRIMARY KEY (cookbook_id, store, id)
  )`,
  `CREATE INDEX IF NOT EXISTS records_received ON records (cookbook_id, received)`,
  `CREATE TABLE IF NOT EXISTS push_subscriptions (
    endpoint TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    p256dh TEXT NOT NULL,
    auth TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  // a running kitchen timer: the server sends a push message at `due` to the device that started it
  `CREATE TABLE IF NOT EXISTS timers (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    endpoint TEXT NOT NULL,
    due INTEGER NOT NULL,
    payload TEXT NOT NULL,
    created INTEGER NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS kv (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  )`,
];

export function openDb(file: string): DatabaseSync {
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  for (const s of SCHEMA) db.exec(s);
  return db;
}
