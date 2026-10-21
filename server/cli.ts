// Administration on the server, e.g. inside the container: node /srv/server/cli.mjs <command>
//
//   cookbook-create --name "Daniels Kochbuch"
//   cookbooks                                   cookbooks with members and record counts
//   invite --cookbook <id|name> --name <person> [--role owner|editor|reader] [--days 14]
//   invite --cookbook <id|name> --user <id|name> [--days 14]      another device for an existing person
//   users | audit [n] | logout <user-id> | passkey-remove <passkey-id> | backup <file>
//   user-remove <user-id|name>                  person, passkeys, sessions and memberships (their comments stay)
//
// Recipes (for agents and scripts; --cookbook may be left out while there is only one cookbook):
//   recipes [--cookbook X]                      id, versions, feedback count, title
//   show <recipe> [--version n]                 source text of a version (default: current)
//   context <recipe>                            current source + versions + all feedback, for writing the next version
//   commit <recipe|new> --message "…" [--author Name] [--parent n] < source.txt
//                                               new version (refused if the recipe has errors or version n is no longer current)
//   import <file|dir> [--author Name] [--message "…"]   new recipes from .txt files; same title + different text → new version
//   export <dir>                                current version of every recipe as <title>.txt
import { mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { basename, join } from 'node:path';
import { parse } from '../src/recipe/format.ts';
import { createCookbook, createInvite, ROLES } from './app.ts';
import { commit, context, cookbookId, entries, find, type Author } from './cookbook.ts';
import { openDb } from './db.ts';

const dataDir = process.env.DATA_DIR || 'data';
mkdirSync(dataDir, { recursive: true });
const db = openDb(join(dataDir, 'herdgang.db'));
const origin = (process.env.ORIGIN || 'http://localhost:8080').split(',')[0].trim();
const [cmd, ...args] = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const positional = () => args.filter((a, i) => !a.startsWith('--') && (i === 0 || !args[i - 1].startsWith('--')));
const author = (): Author => ({ id: 'cli', name: opt('author') || 'Daniel' });

function user(key: string | undefined): string {
  if (!key) throw new Error('--user missing');
  const row = db.prepare('SELECT id FROM users WHERE id = ? OR name = ?').all(key, key) as { id: string }[];
  if (row.length !== 1) throw new Error(row.length ? 'Ambiguous user: ' + key : 'User not found: ' + key);
  return row[0].id;
}

function stdin(): string {
  return readFileSync(0, 'utf8');
}

try {
  if (cmd === 'cookbook-create') {
    const name = opt('name');
    if (!name) throw new Error('--name missing');
    console.log(createCookbook(db, name));
  } else if (cmd === 'cookbooks') {
    for (const c of db.prepare('SELECT * FROM cookbooks').all() as { id: string; name: string }[]) {
      const members = db.prepare('SELECT u.name, m.role FROM members m JOIN users u ON u.id = m.user_id WHERE m.cookbook_id = ?').all(c.id) as { name: string; role: string }[];
      const n = db.prepare('SELECT store, count(*) AS n FROM records WHERE cookbook_id = ? AND deleted = 0 GROUP BY store').all(c.id);
      console.log(c.id, c.name, members.map((m) => `${m.name} (${m.role})`).join(', ') || '–', JSON.stringify(n));
    }
  } else if (cmd === 'invite') {
    const cb = cookbookId(db, opt('cookbook'));
    const userId = opt('user') ? user(opt('user')) : undefined;
    const role = opt('role') || (userId ? 'reader' : 'reader');
    if (ROLES.indexOf(role) < 0) throw new Error('--role must be owner, editor or reader');
    if (!userId && !opt('name')) throw new Error('--name or --user missing');
    const inv = createInvite(db, { cookbookId: cb, name: opt('name'), userId, role, days: Number(opt('days') || 14) });
    console.log(`${origin}/login/?invite=${inv.code}`);
    console.log(`valid until ${new Date(inv.expires).toISOString()}, single use`);
  } else if (cmd === 'users') {
    const sql = `SELECT u.id, u.name, u.disabled,
      (SELECT count(*) FROM credentials c WHERE c.user_id = u.id) AS passkeys,
      (SELECT count(*) FROM sessions s WHERE s.user_id = u.id) AS sessions,
      (SELECT group_concat(m.cookbook_id || ':' || m.role) FROM members m WHERE m.user_id = u.id) AS cookbooks
      FROM users u`;
    for (const u of db.prepare(sql).all()) console.log(u);
    for (const c of db.prepare('SELECT id, user_id, label, created, last_used FROM credentials').all()) console.log(c);
  } else if (cmd === 'logout' && args[0]) {
    console.log(db.prepare('DELETE FROM sessions WHERE user_id = ?').run(args[0]));
  } else if (cmd === 'user-remove' && args[0]) {
  const id = user(args[0]);
  db.exec('BEGIN');
  for (const t of ['sessions', 'credentials', 'members', 'push_subscriptions', 'timers']) db.prepare(`DELETE FROM ${t} WHERE user_id = ?`).run(id);
  db.prepare('DELETE FROM invites WHERE user_id = ?').run(id);
  db.prepare('DELETE FROM users WHERE id = ?').run(id);
  db.exec('COMMIT');
  console.log('removed ' + id);
} else if (cmd === 'passkey-remove' && args[0]) {
    console.log(db.prepare('DELETE FROM credentials WHERE id = ?').run(args[0]));
  } else if (cmd === 'audit') {
    for (const r of db.prepare('SELECT * FROM audit ORDER BY time DESC LIMIT ?').all(Number(args[0] || 30))) console.log(r);
  } else if (cmd === 'backup' && args[0]) {
    db.prepare('VACUUM INTO ?').run(args[0]);
    console.log('Backup written: ' + args[0]);
  } else if (cmd === 'recipes') {
    const cb = cookbookId(db, opt('cookbook'));
    for (const e of entries(db, cb)) console.log(`${e.recipe.id}  v${e.revisions.length}  ${String(e.comments.length).padStart(2)} Rückm.  ${e.title}`);
  } else if (cmd === 'show') {
    const e = find(db, cookbookId(db, opt('cookbook')), positional()[0] || '');
    const v = Number(opt('version') || e.revisions.length);
    const rev = e.revisions[v - 1];
    if (!rev) throw new Error('No version ' + v);
    process.stdout.write(rev.source.endsWith('\n') ? rev.source : rev.source + '\n');
  } else if (cmd === 'context') {
    process.stdout.write(context(find(db, cookbookId(db, opt('cookbook')), positional()[0] || '')));
  } else if (cmd === 'commit') {
    const cb = cookbookId(db, opt('cookbook'));
    const key = positional()[0];
    if (!key) throw new Error('recipe (or "new") missing');
    const recipeId = key === 'new' ? undefined : find(db, cb, key).recipe.id;
    const parent = opt('parent') ? Number(opt('parent')) : undefined;
    const r = commit(db, cb, { recipeId, source: stdin(), message: opt('message') || '', author: author(), parent });
    console.log(`Version ${r.version} of ${r.recipeId} stored`);
  } else if (cmd === 'import') {
    const cb = cookbookId(db, opt('cookbook'));
    const src = positional()[0];
    if (!src) throw new Error('file or directory missing');
    const files = statSync(src).isDirectory() ? readdirSync(src).filter((f) => f.endsWith('.txt')).sort().map((f) => join(src, f)) : [src];
    let created = 0;
    let updated = 0;
    for (const f of files) {
      const source = readFileSync(f, 'utf8').replace(/\r\n?/g, '\n');
      const title = parse(source).recipe.title;
      const existing = entries(db, cb).find((e) => e.title === title);
      if (existing && existing.revisions[existing.revisions.length - 1].source === source) continue;
      const r = commit(db, cb, { recipeId: existing ? existing.recipe.id : undefined, source, message: opt('message') || (existing ? 'Überarbeitet' : 'Erste Fassung'), author: author() });
      if (existing) updated++;
      else created++;
      console.log(`${basename(f)} → v${r.version} ${title}`);
    }
    console.log(`${created} new, ${updated} updated`);
  } else if (cmd === 'export') {
    const cb = cookbookId(db, opt('cookbook'));
    const dir = positional()[0];
    if (!dir) throw new Error('directory missing');
    mkdirSync(dir, { recursive: true });
    for (const e of entries(db, cb)) {
      const name = e.title.replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-').toLowerCase() || e.recipe.id;
      writeFileSync(join(dir, name + '.txt'), e.revisions[e.revisions.length - 1].source);
    }
    console.log('exported to ' + dir);
  } else {
    console.log('Commands: cookbook-create | cookbooks | invite | users | user-remove | logout | passkey-remove | audit | backup | recipes | show | context | commit | import | export');
    process.exitCode = 1;
  }
} catch (err) {
  console.error((err as Error).message);
  process.exitCode = 1;
}
db.close();
