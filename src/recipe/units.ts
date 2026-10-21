// Amounts for display: scaling, grams as the default, kitchen measures (ml, EL, TL) and counts on request.
//
// Rules (Daniel's wish): everything is shown in grams by default. Countable things (eggs, sachets, cloves) are shown as
// a count by default and in grams only on request. Converted values are marked as approximate.
import { UNITS, type Ingredient } from './format.ts';

interface Known {
  re: RegExp;
  /** g per ml */
  density?: number;
  /** g per piece (for counts without "= … g") */
  piece?: number;
  /** g per unit for units that depend on the ingredient (a bunch of parsley, a leaf of basil) */
  per?: Record<string, number>;
  /** singular/plural of the noun, for counts */
  one?: string;
  many?: string;
}

// Rough kitchen values. Order matters: the first match wins (specific before general).
const KNOWN: Known[] = [
  { re: /^eigelb/i, piece: 18, one: 'Eigelb', many: 'Eigelb' },
  { re: /^eiweiß|^eiklar/i, piece: 32, one: 'Eiweiß', many: 'Eiweiß' },
  // edible part without the shell, by size class
  { re: /^ei(er)?\b.*\bgröße s\b/i, piece: 42, one: 'Ei', many: 'Eier' },
  { re: /^ei(er)?\b.*\bgröße l\b/i, piece: 58, one: 'Ei', many: 'Eier' },
  { re: /^ei(er)?\b.*\bgröße xl\b/i, piece: 65, one: 'Ei', many: 'Eier' },
  { re: /^ei(er)?\b/i, piece: 50, one: 'Ei', many: 'Eier' },
  { re: /vanill\w*zucker/i, piece: 8, density: 0.85 },
  { re: /backpulver/i, piece: 15, density: 0.75 },
  { re: /natron/i, density: 0.9 },
  { re: /trockenhefe/i, piece: 7, density: 0.6 },
  { re: /hefe/i, piece: 42 },
  { re: /puddingpulver/i, piece: 37, density: 0.6 },
  { re: /gelatine/i, piece: 1.7 },
  { re: /knoblauch/i, piece: 4 },
  { re: /^zwiebel/i, piece: 90, one: 'Zwiebel', many: 'Zwiebeln' },
  { re: /^zitrone/i, piece: 100, one: 'Zitrone', many: 'Zitronen' },
  { re: /^limette/i, piece: 70, one: 'Limette', many: 'Limetten' },
  { re: /^kartoffel/i, piece: 120, one: 'Kartoffel', many: 'Kartoffeln' },
  { re: /^tomate/i, piece: 90, one: 'Tomate', many: 'Tomaten' },
  { re: /^karotte|^möhre/i, piece: 80 },
  { re: /^banane/i, piece: 120, one: 'Banane', many: 'Bananen' },
  { re: /^apfel|^äpfel/i, piece: 150, one: 'Apfel', many: 'Äpfel' },
  { re: /^semmel|^brötchen/i, piece: 50 },
  { re: /lorbeer/i, piece: 0.2 },
  { re: /^brezen?$/i, piece: 85, one: 'Breze', many: 'Brezen' },
  { re: /oblaten/i, piece: 0.25 },
  { re: /sahnefestiger|sahnesteif/i, piece: 8 },
  { re: /^schalotte/i, piece: 30, one: 'Schalotte', many: 'Schalotten' },
  { re: /camembert/i, piece: 125 },
  { re: /schnitzel/i, piece: 150 },
  { re: /^doraden?\b/i, piece: 400 },
  { re: /basilikum/i, per: { Blatt: 0.5 } },
  { re: /petersilie/i, per: { Bund: 40 } },
  { re: /^schnittlauch$/i, per: { Bund: 30 } },
  { re: /^salz|meersalz|fleur de sel/i, density: 1.2 },
  { re: /puderzucker/i, density: 0.55 },
  { re: /zucker/i, density: 0.85 },
  { re: /speisestärke|stärke/i, density: 0.6 },
  { re: /mehl/i, density: 0.55 },
  { re: /grieß/i, density: 0.65 },
  { re: /kakao/i, density: 0.45 },
  { re: /espresso.*pulver|instant/i, density: 0.35 },
  { re: /zimt|paprikapulver|currypulver|kurkuma|kreuzkümmel|koriander, gemahlen|gemahlener koriander|garam|pfeffer|muskat|gewürz|anis|kardamom|chilipulver|chiliflocken|majoran|oregano|thymian, getrocknet|kräuter, getrocknet/i, density: 0.5 },
  { re: /haferflocken/i, density: 0.4 },
  { re: /semmelbrösel|paniermehl/i, density: 0.45 },
  { re: /kokosraspel/i, density: 0.35 },
  { re: /gemahlen|mandeln|haselnüsse|walnüsse|nüsse/i, density: 0.45 },
  { re: /rosinen/i, density: 0.6 },
  { re: /reis/i, density: 0.85 },
  { re: /honig/i, density: 1.4 },
  { re: /sirup/i, density: 1.35 },
  { re: /olivenöl|öl\b|öl,|sonnenblumenöl|rapsöl/i, density: 0.92 },
  { re: /butter/i, density: 0.95 },
  { re: /milch/i, density: 1.03 },
  { re: /sahne|schmand|crème|creme|saure|sauerrahm/i, density: 1.0 },
  { re: /joghurt|quark/i, density: 1.04 },
  { re: /senf/i, density: 1.05 },
  { re: /essig|balsamico|wasser|saft|wein|brühe|fond|rum|bier|kaffee|espresso/i, density: 1.0 },
];

const VOLUME_ML: Record<string, number> = { ml: 1, l: 1000, EL: 15, TL: 5, Tasse: 250, 'Msp.': 0.5 };
const COUNT_G: Record<string, number> = { Prise: 0.4, Spritzer: 1, Tropfen: 0.05, Schuss: 15 };
const PLURAL: Record<string, string> = {
  Prise: 'Prisen',
  Zehe: 'Zehen',
  Dose: 'Dosen',
  Scheibe: 'Scheiben',
  Zweig: 'Zweige',
  Knolle: 'Knollen',
  Stange: 'Stangen',
  Tasse: 'Tassen',
  Blatt: 'Blatt',
  Glas: 'Gläser',
};

export type Choice = 'g' | 'ml' | 'EL' | 'TL' | 'count' | 'source';

export function known(name: string): Known | undefined {
  return KNOWN.find((k) => k.re.test(name));
}

export function kind(ing: Ingredient): 'mass' | 'volume' | 'count' | 'none' {
  if (!ing.amount) return 'none';
  if (!ing.unit) return 'count';
  return UNITS[ing.unit.toLowerCase()].kind;
}

/** weight in grams of the amount as written (lower bound), if it can be derived */
export function gramsOf(ing: Ingredient): number | undefined {
  if (ing.grams !== undefined) return ing.grams;
  if (!ing.amount) return undefined;
  const k = kind(ing);
  const n = ing.amount.min;
  if (k === 'mass') return ing.unit === 'kg' ? n * 1000 : n;
  const info = known(ing.name);
  if (k === 'volume') return info && info.density ? n * VOLUME_ML[ing.unit as string] * info.density : undefined;
  if (k === 'count') {
    if (ing.unit && COUNT_G[ing.unit] !== undefined) return n * COUNT_G[ing.unit];
    if (ing.unit && info && info.per && info.per[ing.unit] !== undefined) return n * info.per[ing.unit];
    if (ing.unit === 'Päckchen' || ing.unit === 'Würfel' || ing.unit === 'Zehe' || !ing.unit || ing.unit === 'Stück') return info && info.piece ? n * info.piece : undefined;
  }
  return undefined;
}

/** which display units make sense for this ingredient; the first is the default */
export function choices(ing: Ingredient): Choice[] {
  const k = kind(ing);
  if (k === 'none') return [];
  const g = gramsOf(ing);
  const info = known(ing.name);
  const out: Choice[] = [];
  if (k === 'count') {
    out.push('count');
    if (g !== undefined) out.push('g');
    return out;
  }
  if (g !== undefined) out.push('g');
  else out.push('source');
  if (g !== undefined && info && info.density) {
    const ml = g / info.density;
    out.push('ml');
    if (ml <= 120) out.push('EL');
    if (ml <= 30) out.push('TL');
  }
  if (k === 'volume' && g !== undefined) out.push('source');
  if (g !== undefined && info && info.piece && info.one) out.push('count');
  return out.filter((c, i) => out.indexOf(c) === i);
}

export interface Shown {
  /** number part, e.g. "150", "1½", "≈ 2" */
  qty: string;
  /** unit word as shown ("g", "EL", "Prisen", "") */
  unit: string;
  /** noun to show (singular/plural adjusted for counts) */
  name: string;
  approx: boolean;
}

const nf = (digits: number) => new Intl.NumberFormat('de-DE', { maximumFractionDigits: digits });

/** grams: one decimal below 10 g, whole grams up to 1 kg, then steps of 5 g */
export function fmtGrams(g: number): string {
  if (g < 10) return nf(1).format(Math.round(g * 10) / 10);
  if (g < 1000) return nf(0).format(Math.round(g));
  return nf(0).format(Math.round(g / 5) * 5);
}

/** counts and spoons: whole numbers with ¼ ½ ¾ */
export function fmtFraction(x: number, step = 0.25): string {
  if (x <= 0) return '0';
  const q = Math.round(x / step) * step;
  if (q === 0) return '¼';
  const whole = Math.floor(q);
  const rest = q - whole;
  const sym = rest === 0.25 ? '¼' : rest === 0.5 ? '½' : rest === 0.75 ? '¾' : '';
  return (whole ? String(whole) : '') + sym;
}

function fmtMl(ml: number): string {
  if (ml < 10) return nf(1).format(Math.round(ml * 2) / 2);
  if (ml < 100) return nf(0).format(Math.round(ml));
  return nf(0).format(Math.round(ml / 5) * 5);
}

function range(ing: Ingredient, factor: number, f: (x: number) => string, per = 1): string {
  const a = ing.amount as { min: number; max?: number };
  const lo = f(a.min * factor * per);
  return a.max !== undefined ? lo + '–' + f(a.max * factor * per) : lo;
}

function noun(ing: Ingredient, n: number): string {
  const info = known(ing.name);
  if (!info || !info.one || !info.many) return ing.name;
  const word = /^\S+/.exec(ing.name);
  if (!word) return ing.name;
  const rest = ing.name.slice(word[0].length);
  return (n > 1 || n === 0 ? info.many : info.one) + rest;
}

/** amount for display; factor = scaling (1 = as written) */
export function show(ing: Ingredient, factor: number, choice?: Choice): Shown {
  const options = choices(ing);
  if (!ing.amount) return { qty: '', unit: '', name: ing.name, approx: false };
  const c = choice && options.indexOf(choice) >= 0 ? choice : options[0];
  const approx = !!ing.approx;
  const g = gramsOf(ing);
  const k = kind(ing);
  const perUnitG = g !== undefined ? g / ing.amount.min : 0;
  if (c === 'count' && k === 'count') {
    const n = ing.amount.min * factor;
    const unit = ing.unit && ing.unit !== 'Stück' ? (n > 1 ? PLURAL[ing.unit] || ing.unit : ing.unit) : '';
    return { qty: range(ing, factor, (x) => fmtFraction(x)), unit, name: ing.unit ? ing.name : noun(ing, n), approx };
  }
  if (c === 'count') {
    const info = known(ing.name) as Known;
    const n = ((g as number) * factor) / (info.piece as number);
    return { qty: '≈ ' + fmtFraction(n), unit: '', name: n > 1 ? info.many + ing.name.slice((/^\S+/.exec(ing.name) || [''])[0].length) : ing.name, approx: true };
  }
  if (c === 'g') {
    const exact = k === 'mass' || (k === 'count' && ing.grams !== undefined);
    return { qty: (exact ? '' : '≈ ') + range(ing, factor, fmtGrams, perUnitG), unit: 'g', name: ing.name, approx: approx || !exact };
  }
  if (c === 'ml' || c === 'EL' || c === 'TL') {
    const density = (known(ing.name) as Known).density as number;
    const per = perUnitG / density / (c === 'ml' ? 1 : c === 'EL' ? 15 : 5);
    const exact = k === 'volume' && ing.unit === c;
    const f = c === 'ml' ? fmtMl : c === 'EL' ? (x: number) => fmtFraction(x, 0.5) : (x: number) => fmtFraction(x);
    return { qty: (exact ? '' : '≈ ') + range(ing, factor, f, per), unit: c, name: ing.name, approx: !exact };
  }
  // as written (volume without known density, or the original measure)
  const unit = ing.unit === 'kg' || ing.unit === 'l' ? ing.unit : ing.unit || '';
  const f = ing.unit === 'EL' || ing.unit === 'TL' || ing.unit === 'Tasse' ? (x: number) => fmtFraction(x) : (x: number) => nf(1).format(x);
  return { qty: range(ing, factor, f), unit, name: ing.name, approx };
}

/** short label for the unit switch ("g", "ml", "EL", "TL", "Stück") */
export function choiceLabel(c: Choice, ing: Ingredient): string {
  if (c === 'count') return ing.unit && ing.unit !== 'Stück' ? ing.unit : 'Stück';
  if (c === 'source') return ing.unit || '';
  return c;
}

/** scaled amount as one plain string, e.g. "150 g", "1½ Eier", "1 Prise" */
export function amountText(ing: Ingredient, factor: number, choice?: Choice): string {
  const s = show(ing, factor, choice);
  return [s.qty, s.unit].filter(Boolean).join(' ');
}
