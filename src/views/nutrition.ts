// Nutrition facts of a recipe (tab „Zutaten“): a small table per portion and in total, which food each ingredient was
// counted as, and – for people who may edit – choosing a different food for an ingredient (kept per cookbook).
import { foodsNow, loadFoods } from '../foods.ts';
import type { Recipe } from '../recipe/format.ts';
import { bases, facts, fmtValue, foodKey, NUTRIENTS, perBasis, searchFoods, summary, type FoodTable, type Line } from '../recipe/nutrition.ts';
import { fmtGrams } from '../recipe/units.ts';
import { chooseFood, foodChoices } from '../state.ts';
import { canEdit } from '../sync.ts';
import { clear, h } from '../ui/dom.ts';

export const SOURCE_NOTE =
  'Quelle der Werte: Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut (2025), Lizenz CC BY 4.0 – als Auszug übernommen und den Zutaten zugeordnet.';

/** a food was chosen for an ingredient: badges and sections draw again */
const changed = () => window.dispatchEvent(new Event('herdgang:foods'));

/** „≈ 520 kcal pro Portion“ for the facts line; hidden until the table is loaded */
export function kcalButton(r: Recipe, factor: () => number, open: () => void): { el: HTMLElement; update: () => void } {
  const el = h('button', { type: 'button', class: 'kcal hidden', onclick: open, title: 'Nährwerte zeigen' });
  const update = () => {
    const table = foodsNow();
    if (!table) return;
    const f = facts(r, table, foodChoices(), factor());
    if (f.total[0] <= 0) return;
    el.textContent = summary(f, r, factor());
    el.classList.remove('hidden');
  };
  const onFoods = () => (el.isConnected ? update() : window.removeEventListener('herdgang:foods', onFoods));
  window.addEventListener('herdgang:foods', onFoods);
  void loadFoods().then(update);
  return { el, update };
}

/** the nutrition block for the PDF (only if the table is loaded already) */
export function pdfNutrition(r: Recipe, factor: number): { title: string; text: string; source: string } | undefined {
  const table = foodsNow();
  if (!table) return undefined;
  const f = facts(r, table, foodChoices(), factor);
  if (f.total[0] <= 0) return undefined;
  const b = bases(r)[0];
  const v = perBasis(f.total, b, factor);
  const parts = NUTRIENTS.map((n, i) => (n.sub ? '(' + n.label + ' ' + fmtValue(n.key, v[i]) + ')' : n.label + ' ' + fmtValue(n.key, v[i])));
  return {
    title: 'Nährwerte ' + b.label + ' (ungefähr)',
    text: parts.join(' · ').replace(/ · \(/g, ' ('),
    source: 'Berechnet aus den Zutaten mit dem Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut (2025), Lizenz CC BY 4.0.',
  };
}

const cleanName = (name: string) => name.replace(/\([^)]*\)/g, ' ').replace(/\s+/g, ' ').trim();

interface Group {
  name: string;
  counted: number;
  weighed: boolean;
  line: Line;
  why: string[];
}

function groups(lines: Line[]): Group[] {
  const out: Group[] = [];
  for (const l of lines) {
    let g = out.find((x) => x.name === l.ing.name);
    if (!g) out.push((g = { name: l.ing.name, counted: 0, weighed: false, line: l, why: [] }));
    g.counted += l.counted;
    if (l.grams !== undefined) g.weighed = true;
    if (l.why && g.why.indexOf(l.why) < 0) g.why.push(l.why);
  }
  return out;
}

export function nutritionSection(r: Recipe, factor: number): HTMLElement {
  const box = h('section', { class: 'nutri', id: 'naehrwerte' });
  const state = { open: false, picking: '' };
  const title = () => h('h2', { class: 'sec-title' }, 'Nährwerte');
  box.append(title(), h('p', { class: 'muted' }, 'Wird geladen …'));

  const draw = (table: FoodTable) => {
    clear(box);
    const f = facts(r, table, foodChoices(), factor);
    const bs = bases(r);
    box.append(title(), h('p', { class: 'muted small' }, 'Ungefähre Werte, aus den Zutaten berechnet.'));
    const head = h('tr', null, h('th', null, ''), ...bs.map((b) => h('th', { scope: 'col' }, b.label)));
    const rows = NUTRIENTS.map((n, i) =>
      h('tr', { class: n.sub ? 'sub' : '' }, h('th', { scope: 'row' }, n.label), ...bs.map((b) => h('td', null, fmtValue(n.key, perBasis(f.total, b, factor)[i])))),
    );
    box.append(h('table', { class: 'facts-table' }, h('thead', null, head), h('tbody', null, ...rows)));

    const names = (ls: Line[]) => ls.map((l) => l.ing.name).filter((x, i, a) => a.indexOf(x) === i).join(', ');
    const guessed = f.lines.filter((l) => l.match.how === 'guess' && l.counted > 0);
    if (f.unmatched.length) box.append(h('p', { class: 'notice' }, 'Ohne Werte, fehlt in der Rechnung: ' + names(f.unmatched) + '.'));
    if (guessed.length) box.append(h('p', { class: 'small' }, 'Nach dem Namen zugeordnet – bitte prüfen: ' + names(guessed) + '.'));
    if (f.unweighed.length) box.append(h('p', { class: 'muted small' }, 'Ohne Mengenangabe, nicht gerechnet: ' + names(f.unweighed) + '.'));
    if (f.skipped.length) box.append(h('p', { class: 'muted small' }, 'Bewusst nicht gerechnet (Gewürze, Aromen): ' + names(f.skipped) + '.'));
    if (f.variants.length) box.append(h('p', { class: 'muted small' }, 'Aus einer Variante, nicht gerechnet: ' + names(f.variants) + '.'));

    const list = h('div', { class: 'sources' });
    const editable = canEdit();
    const chosen = foodChoices();
    const all = groups(f.lines);
    for (const g of all) {
      const m = g.line.match;
      const target = m.food ? m.food.name : m.how === 'skip' ? 'nicht gerechnet' : 'keine Werte gefunden';
      const tag = m.how === 'guess' ? h('span', { class: 'badge warn' }, 'geraten') : m.how === 'chosen' || chosen[foodKey(g.name)] !== undefined ? h('span', { class: 'badge' }, 'von Hand') : null;
      const change =
        editable && state.picking !== g.name ? h('button', { type: 'button', class: 'link', onclick: () => ((state.picking = g.name), draw(table)) }, 'ändern') : null;
      const row = h('div', { class: 'src' },
        h('div', { class: 'src-main' },
          h('span', { class: 'nm' }, g.name),
          h('span', { class: 'g' }, g.counted > 0 ? fmtGrams(g.counted) + ' g' : '–')),
        h('div', { class: 'src-food' }, h('span', null, '→ ' + target + ' ', tag), change),
        g.why.length ? h('div', { class: 'muted small' }, g.why.join('; ')) : null,
      );
      if (state.picking === g.name) row.append(picker(g.name, m.food ? m.food.name : '', table, chosen[foodKey(g.name)] !== undefined, () => ((state.picking = ''), draw(table))));
      list.append(row);
    }
    const details = h('details', { class: 'equip card' }, h('summary', null, `Woher die Werte kommen (${all.length} Zutaten)`), list, h('p', { class: 'muted small' }, SOURCE_NOTE));
    if (state.open) details.setAttribute('open', '');
    details.addEventListener('toggle', () => (state.open = (details as HTMLDetailsElement).open));
    box.append(details);
  };

  const start = () =>
    void loadFoods().then((table) => {
      if (table) draw(table);
      else {
        clear(box);
        box.append(title(), h('p', { class: 'muted' }, 'Die Nährwerttabelle lässt sich gerade nicht laden. Später noch einmal öffnen.'));
      }
    });
  const onFoods = () => (box.isConnected ? start() : window.removeEventListener('herdgang:foods', onFoods));
  window.addEventListener('herdgang:foods', onFoods);
  start();
  return box;
}

/** search in the table; the choice is kept for this ingredient name in the whole cookbook */
function picker(name: string, current: string, table: FoodTable, hasChoice: boolean, done: () => void): HTMLElement {
  // start with a search that finds something: the name, its last or first word, or the food counted so far
  const words = cleanName(name).split(' ');
  const tries = [words.join(' '), words[words.length - 1], words[0], cleanName(current).split(/[\s,/]+/)[0]];
  const first = tries.find((q) => q && searchFoods(table, q, 1).length) || words.join(' ');
  const input = h('input', { type: 'search', value: first, 'aria-label': 'Lebensmittel suchen', enterkeyhint: 'search', autocomplete: 'off' }) as HTMLInputElement;
  const list = h('div', { class: 'pick-list' });
  const choose = (code: string | null) =>
    void chooseFood(name, code).then(() => {
      done();
      changed();
    });
  const show = () => {
    clear(list);
    const hits = searchFoods(table, input.value, 8);
    if (!hits.length) list.append(h('p', { class: 'muted small' }, 'Nichts gefunden – ein anderes Wort versuchen.'));
    for (const food of hits)
      list.append(h('button', { type: 'button', onclick: () => choose(food.code) }, h('span', null, food.name), h('span', { class: 'muted small' }, fmtValue('kcal', food.per100[0]) + ' je 100 g')));
  };
  input.addEventListener('input', show);
  show();
  return h('div', { class: 'picker' },
    h('p', { class: 'small' }, `Gilt für „${name}“ in allen Rezepten dieses Kochbuchs.`),
    input,
    list,
    h('div', { class: 'row' },
      h('button', { type: 'button', onclick: () => choose('') }, 'Nicht mitrechnen'),
      hasChoice ? h('button', { type: 'button', onclick: () => choose(null) }, 'Automatisch') : null,
      h('button', { type: 'button', class: 'link', onclick: done }, 'Abbrechen')),
  );
}
