// Start page: all recipes of the cookbook with search and tag filter, the ones made most often by this person first.
import { link } from '../nav.ts';
import { cookedCounts, createRecipe, entries, parsed } from '../state.ts';
import { canEdit, currentCookbook, currentMode } from '../sync.ts';
import { clear, h } from '../ui/dom.ts';

declare const __SAMPLE__: string;

let query = '';
let tag = '';

const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');

export function homeView(root: HTMLElement): void {
  const made = cookedCounts();
  // most often made first; otherwise alphabetical (entries() is sorted by title, sort() is stable)
  const all = entries()
    .slice()
    .sort((a, b) => (made[b.recipe.id] || 0) - (made[a.recipe.id] || 0));
  const tags = new Map<string, number>();
  for (const e of all) for (const t of parsed(e.head).recipe.tags) tags.set(t, (tags.get(t) || 0) + 1);
  const list = h('div', { class: 'list' });
  const chips = h('div', { class: 'chips', role: 'group', 'aria-label': 'Schlagworte' });

  const render = () => {
    clear(list);
    const q = norm(query.trim());
    const hits = all.filter((e) => {
      const r = parsed(e.head).recipe;
      if (tag && r.tags.indexOf(tag) < 0) return false;
      if (!q) return true;
      const hay = norm([r.title, r.subtitle || '', r.tags.join(' '), ...r.sections.flatMap((s) => s.steps.flatMap((st) => st.ingredients.map((i) => i.name)))].join(' '));
      return q.split(/\s+/).every((w) => hay.indexOf(w) >= 0);
    });
    for (const e of hits) {
      const r = parsed(e.head).recipe;
      list.appendChild(
        h('a', { class: 'item', href: link('recipe', e.recipe.id) },
          h('h3', null, r.title),
          r.subtitle ? h('p', null, r.subtitle) : null,
          h('div', { class: 'meta' },
            r.time ? h('span', null, '⏱ ' + r.time.split(',')[0]) : null,
            r.yieldText ? h('span', null, r.yieldText) : null,
            made[e.recipe.id] ? h('span', { class: 'badge' }, made[e.recipe.id] + '× gemacht') : null,
            e.revisions.length > 1 ? h('span', { class: 'badge' }, 'v' + e.revisions.length) : null,
            e.comments.length ? h('span', { class: 'badge warn' }, '💬 ' + e.comments.length) : null)),
      );
    }
    if (!hits.length && all.length) list.appendChild(h('p', { class: 'muted' }, 'Nichts gefunden.'));
    clear(chips);
    const sorted = Array.from(tags.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], 'de'));
    for (const [t] of sorted)
      chips.appendChild(
        h('button', { type: 'button', class: 'chip' + (t === tag ? ' on' : ''), 'aria-pressed': t === tag ? 'true' : 'false', onclick: () => ((tag = t === tag ? '' : t), render()) }, t),
      );
  };

  const search = h('input', { type: 'search', placeholder: 'Rezept oder Zutat suchen …', 'aria-label': 'Suchen', value: query, enterkeyhint: 'search' }) as HTMLInputElement;
  search.addEventListener('input', () => {
    query = search.value;
    render();
  });
  root.appendChild(h('div', { class: 'search' }, search));
  if (tags.size) root.appendChild(chips);
  root.appendChild(list);
  if (!all.length) {
    const cb = currentCookbook();
    root.appendChild(
      h('section', { class: 'card' },
        h('h2', null, 'Noch keine Rezepte'),
        h('p', null, cb ? `„${cb.name}“ ist noch leer.` : 'Hier erscheinen deine Rezepte.'),
        currentMode() === 'preview' && typeof __SAMPLE__ === 'string' && __SAMPLE__
          ? h('button', { type: 'button', class: 'primary', onclick: () => void createRecipe(__SAMPLE__, 'Beispiel').then(() => window.dispatchEvent(new Event('herdgang:render'))) }, 'Beispielrezept laden')
          : null),
    );
  }
  if (canEdit()) root.appendChild(h('p', null, h('a', { class: 'button wide', href: link('new') }, '＋ Neues Rezept')));
  render();
}
