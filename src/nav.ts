// Navigation through the hash (#/r/<id>?tab=…), so the app runs under any path (also in previews).
export type Route = 'home' | 'recipe' | 'edit' | 'new' | 'settings' | 'help';

export interface Place {
  route: Route;
  id: string;
  params: URLSearchParams;
}

const PATHS: Record<string, Route> = { r: 'recipe', edit: 'edit', new: 'new', settings: 'settings', help: 'help' };

export function current(): Place {
  const raw = location.hash.replace(/^#\/?/, '');
  const [path, query] = raw.split('?');
  const [head, id] = path.split('/');
  return { route: PATHS[head] || 'home', id: decodeURIComponent(id || ''), params: new URLSearchParams(query || '') };
}

export function link(route: Route, id?: string, query?: Record<string, string | number | undefined | null>): string {
  const head = route === 'home' ? '' : (Object.keys(PATHS).find((k) => PATHS[k] === route) as string);
  const q = query ? Object.entries(query).filter(([, v]) => v !== undefined && v !== null && v !== '') : [];
  return '#/' + head + (id ? '/' + encodeURIComponent(id) : '') + (q.length ? '?' + new URLSearchParams(q.map(([k, v]) => [k, String(v)])).toString() : '');
}

export function go(route: Route, id?: string, query?: Record<string, string | number | undefined | null>): void {
  location.hash = link(route, id, query);
}

/** change the query of the current place without adding a history entry or re-rendering */
export function replaceQuery(query: Record<string, string | number | undefined | null>): void {
  const p = current();
  const url = link(p.route, p.id, { ...Object.fromEntries(p.params), ...query });
  history.replaceState(history.state, '', url);
}
