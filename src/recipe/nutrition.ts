// Nutrition facts of a recipe from the German food composition database (Bundeslebensmittelschlüssel, BLS 4.0,
// Max Rubner-Institut, CC BY 4.0; nutrition/bls.json, made by tools/bls.ts): each ingredient's grams times the values
// of its food per 100 g. Sections titled „Variante …“ are optional and do not count.
//
// Which food an ingredient is: a choice made in the cookbook (store „foods“, key = folded ingredient name) first,
// then the list in foods.ts, then a guess by name (the app marks guesses). Cooking media count only in part: salt for
// the cooking water and fat for deep-frying mostly stay in the pot. Raw weights are summed up, so „pro 100 g“ is only
// offered where the recipe states the finished weight.
import { KNOWN_FOODS } from './foods.ts';
import { allSteps, type Ingredient, type Recipe, type Step } from './format.ts';
import { gramsOf } from './units.ts';

export const NUTRIENTS = [
  { key: 'kcal', label: 'Energie', unit: 'kcal', sub: false },
  { key: 'fat', label: 'Fett', unit: 'g', sub: false },
  { key: 'saturated', label: 'davon gesättigte Fettsäuren', unit: 'g', sub: true },
  { key: 'carbs', label: 'Kohlenhydrate', unit: 'g', sub: false },
  { key: 'sugar', label: 'davon Zucker', unit: 'g', sub: true },
  { key: 'fibre', label: 'Ballaststoffe', unit: 'g', sub: false },
  { key: 'protein', label: 'Eiweiß', unit: 'g', sub: false },
  { key: 'salt', label: 'Salz', unit: 'g', sub: false },
] as const;
export type NutrientKey = (typeof NUTRIENTS)[number]['key'];
/** one value per nutrient, in the order of NUTRIENTS */
export type Values = number[];

/** format of nutrition/bls.json */
export interface FoodFile {
  source: string;
  license: string;
  nutrients: string[];
  /** [code, name, value per 100 g for each nutrient (null = not given)] */
  foods: (string | number | null)[][];
}

export interface Food {
  code: string;
  name: string;
  per100: Values;
}

export interface FoodTable {
  foods: Food[];
  byCode: Map<string, Food>;
  source: string;
  license: string;
}

export function foodTable(f: FoodFile): FoodTable {
  const idx = NUTRIENTS.map((n) => f.nutrients.indexOf(n.key));
  const foods = f.foods.map((row) => ({
    code: String(row[0]),
    name: String(row[1]),
    per100: idx.map((i) => {
      const v = i >= 0 ? row[i + 2] : null;
      return typeof v === 'number' ? v : 0;
    }),
  }));
  return { foods, byCode: new Map(foods.map((x) => [x.code, x])), source: f.source, license: f.license };
}

// ---- finding the food of an ingredient ----

export const fold = (s: string): string =>
  s.toLowerCase().replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss').replace(/[^a-z0-9]+/g, ' ');

/** key of an ingredient name for the choices made in a cookbook */
export const foodKey = (name: string): string => fold(name).trim().slice(0, 100);

/**
 * How well a food name fits a search. German compounds carry the head word at the end: „Trinkwasser“ is water,
 * „Wassermelone“ is not; „Erdnussbutter“ is a kind of butter, „Butterkekse“ are biscuits. Hence: whole word > word
 * end (head word) > word start > anywhere. Words after „mit“, „ohne“ … are additions and count little. Short names
 * (basic foods) before long ones (dishes), raw before cooked. 0 = no match (not every search word occurs).
 */
export function nameScore(name: string, query: string): number {
  const words = fold(query).split(/\s+/).filter(Boolean);
  if (!words.length) return 0;
  const parts = name
    .toLowerCase()
    .split(/[\s,;()/]+/)
    .map((p) => fold(p.replace(/-/g, '\u0001')).replace(/\s+/g, '').replace(/\u0001/g, '-'))
    .filter(Boolean);
  const PREP = ['mit', 'ohne', 'und', 'in', 'im', 'auf', 'aus', 'fuer', 'nach', 'vom', 'von'];
  let cut = parts.length;
  parts.forEach((p, i) => {
    if (i > 0 && cut === parts.length && PREP.indexOf(p) >= 0) cut = i;
  });
  // words written apart („Hafer Flocken“), singular and plural („Haselnuss“ = „Haselnuesse“)
  const same = (a: string, b: string) => a === b || (a.length >= 4 && b.length >= 4 && (a.startsWith(b) || b.startsWith(a)) && Math.abs(a.length - b.length) <= 2);
  let score = 0;
  let inName = 0;
  for (const w of words) {
    let best = 0;
    parts.forEach((p, i) => {
      const sub = p.split('-').filter(Boolean);
      const whole = sub.join('');
      const head = sub[sub.length - 1] || '';
      const next = i + 1 < cut ? parts[i + 1].replace(/-/g, '') : '';
      let s = 0;
      if (same(whole, w) || (next && same(whole + next, w))) s = 10;
      else if (head === w || (head.length > w.length && head.endsWith(w))) s = 7;
      else if (whole.startsWith(w)) s = 3;
      else if (whole.indexOf(w) >= 0) s = 2;
      if (s && i === 0) s += 2;
      if (i >= cut) s = Math.min(s, 1);
      if (s > best) best = s;
    });
    if (!best) return 0;
    inName++;
    score += best;
  }
  const folded = ' ' + fold(name) + ' ';
  const raw = / roh /.test(folded) ? 2 : /(gebraten|ueberbacken|geduenstet|gekocht|frittiert|paniert|gegrillt|gebacken|zubereitet)/.test(folded) ? -1.5 : 0;
  return score + raw - 0.3 * Math.max(0, parts.length - inName) - name.length / 200;
}

/** foods whose name contains every search word, best first */
export function searchFoods(table: FoodTable, query: string, limit = 8): Food[] {
  const hits: { food: Food; score: number }[] = [];
  for (const food of table.foods) {
    const score = nameScore(food.name, query);
    if (score > 0) hits.push({ food, score });
  }
  return hits
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map((h) => h.food);
}

/**
 * how the food was found: chosen in the cookbook, from the list in foods.ts, guessed by name; „skip“ = not counted on
 * purpose (spices, flavourings), „none“ = nothing found
 */
export type How = 'chosen' | 'list' | 'guess' | 'skip' | 'none';

export interface Match {
  food?: Food;
  how: How;
  /** edible share of the weight as written (whole fish) */
  edible?: number;
}

const guesses = new Map<string, Food | null>();

function guess(name: string, table: FoodTable): Food | undefined {
  const hit = guesses.get(name);
  if (hit !== undefined) return hit || undefined;
  // without notes in brackets; leading adjectives are dropped one by one („gehackte Mandeln“ → „Mandeln“)
  const words = name.replace(/\([^)]*\)/g, ' ').trim().split(/\s+/).filter(Boolean);
  let found: Food | null = null;
  for (let i = 0; i < words.length && !found; i++) {
    const q = words.slice(i).join(' ');
    let best = 0;
    for (const food of table.foods) {
      const s = nameScore(food.name, q);
      if (s > best) (best = s), (found = s >= 7 ? food : found);
    }
  }
  guesses.set(name, found);
  return found || undefined;
}

export function matchFood(name: string, table: FoodTable, chosen: Record<string, string> = {}): Match {
  const listed = KNOWN_FOODS.find(([re]) => re.test(name));
  // the edible share belongs to the ingredient (a whole fish), whichever food it is counted as
  const edible = listed && listed[2] ? { edible: listed[2] } : {};
  const c = chosen[foodKey(name)];
  if (c === '') return { how: 'skip' };
  const picked = c ? table.byCode.get(c) : undefined;
  if (picked) return { food: picked, how: 'chosen', ...edible };
  if (listed) {
    if (listed[1] === '') return { how: 'skip' };
    const food = table.byCode.get(listed[1]);
    if (food) return { food, how: 'list', ...edible };
  }
  const g = guess(name, table);
  return g ? { food: g, how: 'guess', ...edible } : { how: 'none' };
}

// ---- what counts ----

const FAT = /öl$|öl\b|fett|schmalz/i;
const FRYING = /frittier|ausbacken|ausgebacken|schwimm|\d\s*cm hoch/i;
const COOKING_WATER = /kochwasser|nudelwasser|salzwasser|abgießen|natronbad|laugenbad|wasser bedecken, salzen/i;

/** the part of an ingredient that ends up in the food */
export function share(ing: Ingredient, step: Step): { factor: number; why?: string } {
  const text = [step.text, ing.note || '', ing.tip || ''].concat(step.timers.map((t) => t.text)).join(' ');
  if (/frittierfett/i.test(ing.name) || (FAT.test(ing.name) && FRYING.test(text))) {
    return { factor: 0.1, why: 'zum Ausbacken – gerechnet ist nur, was das Gargut aufnimmt (etwa 10 %)' };
  }
  if (/salz|natron/i.test(ing.name)) {
    const pot = step.ingredients.some((i) => /^wasser/i.test(i.name) && (gramsOf(i) || 0) >= 1000);
    if (pot || COOKING_WATER.test(text)) return { factor: 0.1, why: 'fürs Kochwasser – im Essen bleibt nur ein kleiner Teil (gerechnet 10 %)' };
  }
  return { factor: 1 };
}

export interface Line {
  ing: Ingredient;
  /** number of the step */
  step: number;
  /** weight in the recipe (scaled), undefined = no weight known */
  grams?: number;
  /** grams that count (after share) */
  counted: number;
  match: Match;
  why?: string;
}

export interface Facts {
  lines: Line[];
  /** whole recipe (scaled) */
  total: Values;
  /** share of the counted weight with values (0–1) */
  coverage: number;
  /** without a weight (to taste, or a unit without known weight) */
  unweighed: Line[];
  /** weighed, but without values */
  unmatched: Line[];
  /** not counted on purpose (spices, flavourings) */
  skipped: Line[];
  /** in a section „Variante …“, not counted */
  variants: Line[];
}

export function facts(r: Recipe, table: FoodTable, chosen: Record<string, string> = {}, factor = 1): Facts {
  const total = NUTRIENTS.map(() => 0);
  const lines: Line[] = [];
  const unweighed: Line[] = [];
  const unmatched: Line[] = [];
  const skipped: Line[] = [];
  const variants: Line[] = [];
  let all = 0;
  let known = 0;
  for (const { step, section, n } of allSteps(r)) {
    for (const ing of step.ingredients) {
      const g = gramsOf(ing);
      const s = share(ing, step);
      const match = matchFood(ing.name, table, chosen);
      const line: Line = { ing, step: n, match, counted: 0 };
      lines.push(line);
      if (/^variante\b/i.test(section.title || '')) {
        variants.push(line);
        continue;
      }
      if (match.how === 'skip') {
        skipped.push(line);
        continue;
      }
      const why = [s.why, match.edible ? `essbarer Anteil etwa ${Math.round(match.edible * 100)} %` : ''].filter(Boolean).join('; ');
      if (why) line.why = why;
      if (g === undefined) {
        unweighed.push(line);
        continue;
      }
      line.grams = g * factor;
      line.counted = line.grams * s.factor * (match.edible || 1);
      all += line.counted;
      const food = line.match.food;
      if (!food) {
        unmatched.push(line);
        continue;
      }
      known += line.counted;
      food.per100.forEach((v, i) => (total[i] += (v * line.counted) / 100));
    }
  }
  return { lines, total, coverage: all ? known / all : 1, unweighed, unmatched, skipped, variants };
}

// ---- per portion ----

export interface Basis {
  label: string;
  /** how many of these the recipe makes at its base yield */
  count: number;
  /** false: the whole recipe, follows the chosen yield */
  scales: boolean;
}

const ONE: Record<string, string> = {
  Portionen: 'Portion',
  Scheiben: 'Scheibe',
  Stücke: 'Stück',
  Brezen: 'Breze',
  Dampfnudeln: 'Dampfnudel',
  Pizzen: 'Pizza',
  Wraps: 'Wrap',
  Gläser: 'Glas',
  Brote: 'Brot',
  Kuchen: 'Kuchen',
};

function singular(unit: string): string {
  const words = unit.replace(/\(.*$/, '').trim().split(/\s+/);
  const noun = words[words.length - 1] || 'Portion';
  return ONE[noun] || noun;
}

/** what the values are shown for: per portion or piece, per 100 g where the finished weight is known, or in total */
export function bases(r: Recipe): Basis[] {
  const out: Basis[] = [];
  const y = r.yield;
  const text = r.yieldText || '';
  let weight = 0;
  if (y && /^(g|gramm)$/i.test(y.unit)) weight = y.amount;
  else if (y && y.amount > 1) out.push({ label: 'pro ' + singular(y.unit), count: y.amount, scales: true });
  else {
    const m = /etwa (\d+) (Stück|Scheiben|Portionen)/.exec(text);
    if (m) out.push({ label: 'pro ' + singular(m[2]), count: Number(m[1]), scales: true });
  }
  if (!weight && y) {
    const each = /je (?:etwa |ca\. )?(\d+) g\b/.exec(text);
    const whole = /\((?:etwa |ca\. )?(\d+) g\)/.exec(text);
    if (each) weight = Number(each[1]) * y.amount;
    else if (whole) weight = Number(whole[1]);
  }
  if (weight) out.push({ label: 'pro 100 g', count: weight / 100, scales: true });
  if (out.length < 2) out.push({ label: 'gesamt', count: 1, scales: false });
  return out.slice(0, 2);
}

export const perBasis = (total: Values, b: Basis, factor = 1): Values => total.map((v) => v / (b.scales ? b.count * factor : 1));

// ---- display ----

function num(v: number, decimals: number): string {
  const s = v.toFixed(decimals).split('.');
  return s[0].replace(/\B(?=(\d{3})+$)/g, '.') + (s[1] ? ',' + s[1] : '');
}

/** rounded like on a food label (EU guidance on tolerances and rounding) */
export function fmtValue(key: NutrientKey, v: number): string {
  if (key === 'kcal') return num(Math.round(v), 0) + ' kcal';
  if (key === 'salt') return v >= 1 ? num(v, 1) + ' g' : v >= 0.0125 ? num(v, 2) + ' g' : '< 0,01 g';
  if (key === 'saturated') return v >= 10 ? num(v, 0) + ' g' : v >= 0.1 ? num(v, 1) + ' g' : '< 0,1 g';
  return v >= 10 ? num(v, 0) + ' g' : v >= 0.5 ? num(v, 1) + ' g' : '< 0,5 g';
}

/** short line like „≈ 520 kcal pro Portion“ */
export function summary(f: Facts, r: Recipe, factor = 1): string {
  const b = bases(r)[0];
  return '≈ ' + fmtValue('kcal', perBasis(f.total, b, factor)[0]) + ' ' + b.label;
}
