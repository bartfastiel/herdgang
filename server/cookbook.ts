// Recipes, revisions, comments and food choices of a cookbook on the server side – for the command line (agents,
// import, export).
// The app reads and writes the same records through /api/records; the shapes are defined in src/data/types.ts.
import { randomBytes } from 'node:crypto';
import type { DatabaseSync } from 'node:sqlite';
import { parse } from '../src/recipe/format.ts';
import { foodKey } from '../src/recipe/nutrition.ts';
export { context } from '../src/recipe/context.ts';
import type { Comment, FoodChoice, RecipeRec, Revision } from '../src/data/types.ts';
import { nextReceived } from './app.ts';

const newId = () => randomBytes(12).toString('hex');

export function cookbookId(db: DatabaseSync, idOrName: string | undefined): string {
  if (!idOrName) {
    const all = db.prepare('SELECT id FROM cookbooks').all() as { id: string }[];
    if (all.length === 1) return all[0].id;
    throw new Error('--cookbook missing');
  }
  const row = db.prepare('SELECT id FROM cookbooks WHERE id = ? OR name = ?').get(idOrName, idOrName) as { id: string } | undefined;
  if (!row) throw new Error('Cookbook not found: ' + idOrName);
  return row.id;
}

function rows<T>(db: DatabaseSync, cookbook: string, store: string): T[] {
  return (db.prepare('SELECT json FROM records WHERE cookbook_id = ? AND store = ? AND deleted = 0').all(cookbook, store) as { json: string }[]).map(
    (r) => JSON.parse(r.json) as T,
  );
}

export function put(db: DatabaseSync, cookbook: string, store: string, data: { id: string }, updated = Date.now()): void {
  db.prepare(
    'INSERT INTO records (cookbook_id, store, id, json, updated, received, deleted) VALUES (?, ?, ?, ?, ?, ?, 0) ON CONFLICT (cookbook_id, store, id) DO UPDATE SET json = excluded.json, updated = excluded.updated, received = excluded.received, deleted = 0',
  ).run(cookbook, store, data.id, JSON.stringify(data), updated, nextReceived(db, Date.now()));
}

/** tombstone, so that devices learn about the deletion */
export function remove(db: DatabaseSync, cookbook: string, store: string, id: string, updated = Date.now()): void {
  db.prepare('UPDATE records SET json = ?, updated = ?, received = ?, deleted = 1 WHERE cookbook_id = ? AND store = ? AND id = ?').run(
    'null',
    updated,
    nextReceived(db, Date.now()),
    cookbook,
    store,
    id,
  );
}

/** foods chosen by hand: folded ingredient name → code ('' = not counted) */
export function foodChoices(db: DatabaseSync, cookbook: string): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of rows<FoodChoice>(db, cookbook, 'foods')) out[f.id] = f.code;
  return out;
}

/** which food an ingredient counts as in this cookbook; code '' = not counted, null = back to the automatic choice */
export function chooseFood(db: DatabaseSync, cookbook: string, name: string, code: string | null, author: Author): void {
  const id = foodKey(name);
  if (code === null) remove(db, cookbook, 'foods', id);
  else put(db, cookbook, 'foods', { id, name, code, author, created: Date.now() } as FoodChoice);
}

export interface Entry {
  recipe: RecipeRec;
  revisions: Revision[];
  comments: Comment[];
  title: string;
}

/** revisions in version order (oldest first) */
export function sortRevisions(list: Revision[]): Revision[] {
  return list.slice().sort((a, b) => a.created - b.created || (a.id < b.id ? -1 : 1));
}

export function entries(db: DatabaseSync, cookbook: string): Entry[] {
  const revs = rows<Revision>(db, cookbook, 'revisions');
  const comments = rows<Comment>(db, cookbook, 'comments');
  return rows<RecipeRec>(db, cookbook, 'recipes')
    .map((recipe) => {
      const revisions = sortRevisions(revs.filter((r) => r.recipeId === recipe.id));
      const head = revisions[revisions.length - 1];
      return { recipe, revisions, comments: comments.filter((c) => c.recipeId === recipe.id).sort((a, b) => a.created - b.created), title: head ? parse(head.source).recipe.title : '(leer)' };
    })
    .filter((e) => e.revisions.length)
    .sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

/** a recipe by id, id prefix or exact title */
export function find(db: DatabaseSync, cookbook: string, key: string): Entry {
  const list = entries(db, cookbook);
  const hit = list.filter((e) => e.recipe.id === key || e.title.toLowerCase() === key.toLowerCase());
  const pre = hit.length ? hit : list.filter((e) => e.recipe.id.startsWith(key));
  if (pre.length !== 1) throw new Error(pre.length ? 'Ambiguous: ' + key : 'Recipe not found: ' + key);
  return pre[0];
}

export interface Author {
  id: string;
  name: string;
}

/**
 * Stores a new version. `parent` (version number) guards against overwriting changes made in the meantime: if the
 * current head is newer, nothing is written. Returns the new version number.
 */
export function commit(
  db: DatabaseSync,
  cookbook: string,
  opts: { recipeId?: string; source: string; message: string; author: Author; parent?: number; now?: number },
): { recipeId: string; version: number; revisionId: string } {
  const p = parse(opts.source);
  if (p.errors.length) throw new Error('Recipe has errors:\n' + p.errors.map((e) => `  line ${e.line}: ${e.message}`).join('\n'));
  if (!opts.message.trim()) throw new Error('--message missing');
  const t = opts.now || Date.now();
  db.exec('BEGIN IMMEDIATE');
  try {
    let recipeId = opts.recipeId;
    let parentId: string | null = null;
    let version = 1;
    if (recipeId) {
      const revs = sortRevisions(rows<Revision>(db, cookbook, 'revisions').filter((r) => r.recipeId === recipeId));
      if (!revs.length) throw new Error('Recipe not found: ' + recipeId);
      if (opts.parent !== undefined && opts.parent !== revs.length) throw new Error(`Version ${revs.length} is current, not ${opts.parent} – read again, then decide.`);
      const head = revs[revs.length - 1];
      if (head.source === opts.source) throw new Error('No change against version ' + revs.length);
      parentId = head.id;
      version = revs.length + 1;
    } else {
      recipeId = newId();
      put(db, cookbook, 'recipes', { id: recipeId, created: t, createdBy: opts.author } as RecipeRec, t);
    }
    const rev: Revision = { id: newId(), recipeId, parentId, source: opts.source, message: opts.message.trim(), author: opts.author, created: t };
    put(db, cookbook, 'revisions', rev, t);
    db.exec('COMMIT');
    return { recipeId, version, revisionId: rev.id };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
