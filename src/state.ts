// Cookbook data in memory, derived views (recipe with its versions and feedback) and all changes (mirrored to IndexedDB).
import { loadAll, newId, put, remove, type DataSet } from './data/store.ts';
import type { Comment, Cooked, FoodChoice, RecipeRec, Revision } from './data/types.ts';
import { parse, type Parsed } from './recipe/format.ts';
import { foodKey } from './recipe/nutrition.ts';
import { author } from './sync.ts';

export interface Entry {
  recipe: RecipeRec;
  /** oldest first; version n = revisions[n - 1] */
  revisions: Revision[];
  comments: Comment[];
  head: Revision;
  title: string;
}

let data: DataSet = { recipes: [], revisions: [], comments: [], foods: [], cooked: [] };
let list: Entry[] = [];
const parsedCache = new Map<string, Parsed>();

export function parsed(rev: Revision): Parsed {
  let p = parsedCache.get(rev.id);
  if (!p) {
    p = parse(rev.source);
    parsedCache.set(rev.id, p);
  }
  return p;
}

const byTime = (a: { created: number; id: string }, b: { created: number; id: string }) => a.created - b.created || (a.id < b.id ? -1 : 1);

function derive(): void {
  const revs = new Map<string, Revision[]>();
  for (const r of data.revisions) {
    const l = revs.get(r.recipeId) || [];
    l.push(r);
    revs.set(r.recipeId, l);
  }
  const comments = new Map<string, Comment[]>();
  for (const c of data.comments) {
    const l = comments.get(c.recipeId) || [];
    l.push(c);
    comments.set(c.recipeId, l);
  }
  list = [];
  for (const recipe of data.recipes) {
    const revisions = (revs.get(recipe.id) || []).sort(byTime);
    if (!revisions.length) continue;
    const head = revisions[revisions.length - 1];
    list.push({ recipe, revisions, comments: (comments.get(recipe.id) || []).sort(byTime), head, title: parsed(head).recipe.title || 'Ohne Titel' });
  }
  list.sort((a, b) => a.title.localeCompare(b.title, 'de'));
}

export async function reload(): Promise<void> {
  data = await loadAll();
  derive();
}

export const entries = (): Entry[] => list;
export const entry = (id: string): Entry | undefined => list.find((e) => e.recipe.id === id);
export const versionOf = (e: Entry, revisionId: string): number => e.revisions.findIndex((r) => r.id === revisionId) + 1;

/** new recipe with its first version; returns the recipe id */
export async function createRecipe(source: string, message: string): Promise<string> {
  const t = Date.now();
  const recipe: RecipeRec = { id: newId(), created: t, createdBy: author() };
  const rev: Revision = { id: newId(), recipeId: recipe.id, parentId: null, source, message, author: author(), created: t };
  await put([
    { store: 'recipes', value: recipe },
    { store: 'revisions', value: rev },
  ]);
  await reload();
  return recipe.id;
}

/** next version of a recipe (revisions are never changed afterwards) */
export async function commit(e: Entry, source: string, message: string): Promise<Revision> {
  const rev: Revision = { id: newId(), recipeId: e.recipe.id, parentId: e.head.id, source, message, author: author(), created: Math.max(Date.now(), e.head.created + 1) };
  await put([{ store: 'revisions', value: rev }]);
  await reload();
  return rev;
}

export async function addComment(e: Entry, revisionId: string, text: string): Promise<void> {
  const c: Comment = { id: newId(), recipeId: e.recipe.id, revisionId, text, author: author(), created: Date.now() };
  await put([{ store: 'comments', value: c }]);
  await reload();
}

export async function editComment(c: Comment, text: string): Promise<void> {
  const next: Comment = { ...c, text, edited: Date.now() };
  await put([{ store: 'comments', value: next }]);
  await reload();
}

export async function deleteComment(c: Comment): Promise<void> {
  await remove('comments', c.id);
  await reload();
}

export async function deleteRecipe(e: Entry): Promise<void> {
  await remove('recipes', e.recipe.id);
  await reload();
}

/** foods chosen by hand in this cookbook: folded ingredient name → code ('' = not counted) */
export function foodChoices(): Record<string, string> {
  const out: Record<string, string> = {};
  for (const f of data.foods) out[f.id] = f.code;
  return out;
}

/** code '' = do not count this ingredient, null = back to the automatic choice */
export async function chooseFood(name: string, code: string | null): Promise<void> {
  const id = foodKey(name);
  if (code === null) await remove('foods', id);
  else {
    const f: FoodChoice = { id, name, code, author: author(), created: Date.now() };
    await put([{ store: 'foods', value: f }]);
  }
  await reload();
}

/** within this time, looking at a recipe again counts as the same time of making it */
const SAME_COOKING = 6 * 60 * 60 * 1000;

/** the current person made this recipe (once per recipe within six hours) */
export async function markCooked(recipeId: string): Promise<void> {
  const me = author();
  const now = Date.now();
  if (data.cooked.some((c) => c.recipeId === recipeId && c.author.id === me.id && now - c.created < SAME_COOKING)) return;
  const c: Cooked = { id: newId(), recipeId, author: me, created: now };
  await put([{ store: 'cooked', value: c }]);
  await reload();
}

/** how often the current person made each recipe */
export function cookedCounts(): Record<string, number> {
  const me = author().id;
  const out: Record<string, number> = {};
  for (const c of data.cooked) if (c.author.id === me) out[c.recipeId] = (out[c.recipeId] || 0) + 1;
  return out;
}

/** whether the current person may change this comment */
export const mine = (c: Comment): boolean => c.author.id === author().id;
