// Comparing versions (line diff of the source, plus a short summary of changed amounts) and the summed-up
// ingredient list for shopping and setting out (mise en place).
import { allSteps, type Ingredient, type Recipe } from './format.ts';
import { amountText, gramsOf, kind } from './units.ts';

export type DiffLine = { t: 'same' | 'add' | 'del'; s: string };

/** line diff (longest common subsequence); recipes are short, so the quadratic table is fine */
export function diffLines(a: string, b: string): DiffLine[] {
  const x = a.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const y = b.replace(/\r\n?/g, '\n').replace(/\n+$/, '').split('\n');
  const n = x.length;
  const m = y.length;
  const t: number[][] = [];
  for (let i = 0; i <= n; i++) t.push(new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) t[i][j] = x[i] === y[j] ? t[i + 1][j + 1] + 1 : Math.max(t[i + 1][j], t[i][j + 1]);
  const out: DiffLine[] = [];
  let i = 0;
  let j = 0;
  while (i < n && j < m) {
    if (x[i] === y[j]) (out.push({ t: 'same', s: x[i] }), i++, j++);
    else if (t[i + 1][j] >= t[i][j + 1]) out.push({ t: 'del', s: x[i++] });
    else out.push({ t: 'add', s: y[j++] });
  }
  while (i < n) out.push({ t: 'del', s: x[i++] });
  while (j < m) out.push({ t: 'add', s: y[j++] });
  return out;
}

const key = (name: string) => name.toLowerCase().replace(/\s+/g, ' ').trim();

/** "Wasser: 300 g → 320 g", "neu: 5 g Zucker", "entfällt: Rosinen" – what changed in the ingredients */
export function changedAmounts(a: Recipe, b: Recipe): string[] {
  const sum = (r: Recipe) => {
    const m = new Map<string, { name: string; text: string }>();
    for (const item of shoppingList(r)) m.set(key(item.ingredient.name), { name: item.ingredient.name, text: amountText(item.ingredient, 1) });
    return m;
  };
  const x = sum(a);
  const y = sum(b);
  const out: string[] = [];
  for (const [k, v] of y) {
    const old = x.get(k);
    if (!old) out.push('neu: ' + [v.text, v.name].filter(Boolean).join(' '));
    else if (old.text !== v.text) out.push(`${v.name}: ${old.text || '–'} → ${v.text || '–'}`);
  }
  for (const [k, v] of x) if (!y.has(k)) out.push('entfällt: ' + v.name);
  const steps = (r: Recipe) => allSteps(r).length;
  if (steps(a) !== steps(b)) out.push(`Schritte: ${steps(a)} → ${steps(b)}`);
  return out;
}

export interface ListItem {
  /** summed amount (synthetic ingredient, formatted with the usual unit choices) */
  ingredient: Ingredient;
  /** step numbers that use it */
  steps: number[];
  notes: string[];
}

/** all ingredients, summed per name where the units allow it, in the order of first use */
export function shoppingList(r: Recipe): ListItem[] {
  const out: ListItem[] = [];
  for (const { step, n } of allSteps(r)) {
    for (const ing of step.ingredients) {
      const k = kind(ing);
      const same = out.find((o) => key(o.ingredient.name) === key(ing.name) && compatible(o.ingredient, ing));
      if (!same) {
        out.push({ ingredient: { ...ing, amount: ing.amount ? { ...ing.amount } : undefined, tip: undefined, note: undefined }, steps: [n], notes: ing.note ? [ing.note] : [] });
        if (k === 'mass' && ing.unit === 'kg') {
          const o = out[out.length - 1].ingredient;
          o.unit = 'g';
          o.amount = { min: (ing.amount as { min: number }).min * 1000, max: ing.amount && ing.amount.max !== undefined ? ing.amount.max * 1000 : undefined };
          if (o.amount.max === undefined) delete o.amount.max;
        }
        continue;
      }
      if (same.steps.indexOf(n) < 0) same.steps.push(n);
      if (ing.note && same.notes.indexOf(ing.note) < 0) same.notes.push(ing.note);
      add(same.ingredient, ing);
    }
  }
  return out;
}

function compatible(a: Ingredient, b: Ingredient): boolean {
  const ka = kind(a);
  const kb = kind(b);
  if (ka === 'none' || kb === 'none') return ka === kb;
  if (ka === 'mass' && kb === 'mass') return true;
  if (ka === 'count' && kb === 'count') return (a.unit || '') === (b.unit || '');
  if (ka === 'volume' && kb === 'volume') return a.unit === b.unit;
  return false;
}

function add(into: Ingredient, ing: Ingredient): void {
  if (!into.amount || !ing.amount) return;
  const k = kind(ing);
  const f = k === 'mass' && ing.unit === 'kg' ? 1000 : 1;
  const max = (into.amount.max !== undefined ? into.amount.max : into.amount.min) + (ing.amount.max !== undefined ? ing.amount.max : ing.amount.min) * f;
  const hadRange = into.amount.max !== undefined || ing.amount.max !== undefined;
  const gi = gramsOf(into);
  const gb = gramsOf(ing);
  into.amount.min += ing.amount.min * f;
  if (hadRange) into.amount.max = max;
  if (k === 'count') into.grams = gi !== undefined && gb !== undefined && into.grams !== undefined && ing.grams !== undefined ? gi + gb : undefined;
  if (into.grams === undefined) delete into.grams;
}
