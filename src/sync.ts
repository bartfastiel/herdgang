// Sync with the own server (only when signed in, never in previews). Local data leads: the app works offline.
// Records go up and down through /api/records?cookbook=… (newer change wins, deleting as tombstone).
import { allRaw, applyRemote, getMeta, onLocalChange, setMeta, STORES, useDatabase } from './data/store.ts';
import type { Author, Base } from './data/types.ts';

declare const __PREVIEW__: boolean;

export type Mode = 'server' | 'local' | 'preview';
export interface CookbookInfo {
  id: string;
  name: string;
  role: 'owner' | 'editor' | 'reader';
}
export interface Me {
  user: Author;
  cookbooks: CookbookInfo[];
  push_key: string | null;
}

interface RemoteRecord {
  store: string;
  id: string;
  updated: number;
  deleted: boolean;
  data: unknown;
}

const COOKBOOK_KEY = 'herdgang.cookbook';
const LOCAL_USER: Author = { id: 'local', name: 'Ich' };

let mode: Mode = 'local';
let me: Me | null = null;
let cookbook: CookbookInfo | null = null;
let running: Promise<number> | null = null;
let timer = 0;
let afterPull: (() => void) | null = null;
let lastError = '';
let lastSync = 0;
const statusListeners: (() => void)[] = [];

export const currentMode = () => mode;
export const account = () => me;
export const currentCookbook = () => cookbook;
export const syncInfo = () => ({ lastError, lastSync });
/** who is writing: the signed-in person, or a placeholder in local mode and previews */
export const author = (): Author => (me ? { id: me.user.id, name: me.user.name } : LOCAL_USER);
/** whether recipes may be edited here (readers only comment) */
export const canEdit = () => mode !== 'server' || !!(cookbook && cookbook.role !== 'reader');
export const isOwner = () => mode === 'server' && !!(cookbook && cookbook.role === 'owner');

export function onStatus(fn: () => void): void {
  statusListeners.push(fn);
}
const notify = () => statusListeners.forEach((f) => f());

function toLogin(): void {
  location.href = '/login/?next=' + encodeURIComponent(location.pathname + location.hash);
}

function storedCookbook(): string | null {
  try {
    return localStorage.getItem(COOKBOOK_KEY);
  } catch {
    return null;
  }
}

export async function initSync(onPulled: () => void): Promise<Mode> {
  afterPull = onPulled;
  if (typeof __PREVIEW__ !== 'undefined' && __PREVIEW__) {
    useDatabase(null);
    return (mode = 'preview');
  }
  let res: Response | null = null;
  try {
    res = await fetch('/api/me', { headers: { Accept: 'application/json' }, credentials: 'same-origin' });
  } catch {
    res = null;
  }
  if (res && res.status === 401) {
    toLogin();
    return (mode = 'local');
  }
  if (res && res.ok && String(res.headers.get('content-type') || '').indexOf('json') >= 0) {
    me = (await res.json()) as Me;
    try {
      localStorage.setItem('herdgang.me', JSON.stringify(me));
    } catch {}
  } else {
    // offline: use the last known account, so the right cookbook opens
    try {
      me = JSON.parse(localStorage.getItem('herdgang.me') || 'null') as Me | null;
    } catch {
      me = null;
    }
    if (!me) {
      useDatabase(null);
      return (mode = 'local');
    }
  }
  const wanted = storedCookbook();
  cookbook = me.cookbooks.find((c) => c.id === wanted) || me.cookbooks[0] || null;
  useDatabase(cookbook ? cookbook.id : null);
  mode = 'server';
  onLocalChange(() => schedule(1500));
  window.addEventListener('online', () => schedule(0));
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') schedule(0);
  });
  setInterval(() => schedule(0), 2 * 60 * 1000);
  void syncNow();
  return mode;
}

/** switches to another cookbook (reloads the app so everything starts from the right database) */
export function switchCookbook(id: string): void {
  try {
    localStorage.setItem(COOKBOOK_KEY, id);
  } catch {}
  location.hash = '#/';
  location.reload();
}

function schedule(ms: number): void {
  if (mode !== 'server') return;
  clearTimeout(timer);
  timer = window.setTimeout(() => void syncNow(), ms);
}

let again = false;

export function syncNow(): Promise<number> {
  if (mode !== 'server' || !cookbook) return Promise.resolve(0);
  if (running) {
    // a change while a sync runs: run once more afterwards, so nothing waits for the next interval
    again = true;
    return running;
  }
  running = run()
    .catch((err) => {
      lastError = String((err as Error).message || err);
      return 0;
    })
    .finally(() => {
      running = null;
      notify();
      if (again) {
        again = false;
        void syncNow();
      }
    });
  return running;
}

async function run(): Promise<number> {
  const cb = (cookbook as CookbookInfo).id;
  const q = '?cookbook=' + encodeURIComponent(cb);
  lastError = '';
  const lastPush = (await getMeta<number>('pushed')) || 0;
  const changed: RemoteRecord[] = [];
  let maxUpdated = lastPush;
  for (const s of STORES) {
    for (const r of await allRaw<Base>(s)) {
      if ((r.updated || 0) > lastPush) {
        changed.push({ store: s, id: r.id, updated: r.updated || 0, deleted: !!r.deleted, data: r.deleted ? null : r });
        maxUpdated = Math.max(maxUpdated, r.updated || 0);
      }
    }
  }
  for (let i = 0; i < changed.length; i += 500) {
    const res = await post('/api/records' + q, { records: changed.slice(i, i + 500) });
    if (res.status === 401) return (toLogin(), 0);
    if (!res.ok) throw new Error('Hochladen fehlgeschlagen (' + res.status + ')');
  }
  if (changed.length) await setMeta('pushed', maxUpdated);

  let cursor = (await getMeta<number>('cursor')) || 0;
  let applied = 0;
  for (;;) {
    const res = await fetch('/api/records' + q + '&since=' + cursor, { credentials: 'same-origin' }).catch(() => null);
    if (!res) throw new Error('offline');
    if (res.status === 401) return (toLogin(), applied);
    if (!res.ok) throw new Error('Abholen fehlgeschlagen (' + res.status + ')');
    const page = (await res.json()) as { records: RemoteRecord[]; cursor: number; more: boolean };
    applied += await applyRemote(page.records);
    cursor = page.cursor;
    await setMeta('cursor', cursor);
    if (!page.more) break;
  }
  if (applied && afterPull) afterPull();
  lastSync = Date.now();
  return applied;
}

export function post(url: string, body: unknown): Promise<Response> {
  return fetch(url, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).catch(
    () => new Response(null, { status: 503 }),
  );
}

export async function rename(name: string): Promise<boolean> {
  const res = await post('/api/me', { name });
  if (!res.ok || !me) return false;
  me.user.name = ((await res.json()) as { name: string }).name;
  try {
    localStorage.setItem('herdgang.me', JSON.stringify(me));
  } catch {}
  return true;
}

export async function logout(): Promise<void> {
  await syncNow();
  await post('/api/auth/logout', {});
  location.href = '/login/';
}
