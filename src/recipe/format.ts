// Recipe source format ("Herdgang text"). A revision stores the source text; everything else is derived from it.
//
//   # Brownies
//   Untertitel: saftig und sehr schokoladig
//   Ergibt: 12 Stück
//   Zeit: 30 min Arbeit, 3 h gesamt
//   Schlagworte: Backen, Kuchen
//   Geräte: Auflaufform 20 × 30 cm, Backpapier, Topf
//   Hinweis: free text shown above the steps
//   Herkunft: free text (never a link)
//
//   ## Teig                                 ← optional section (phase)
//
//   - 200 g Zartbitterschokolade, gehackt   ← ingredients used in this step, in the order they go in
//   - 3 Eier = 150 g, zimmerwarm {why}      ← "= 150 g": weight of a counted ingredient; {…}: info text
//   Schokolade über dem [Wasserbad]{Direkte Hitze …} schmelzen. **Nicht kochen.**
//   ! Warning or important remark
//   Timer: 25 min – Brownies aus dem Ofen nehmen
//
// Steps are separated by blank lines. The header ends at the first blank line.

export interface Range {
  min: number;
  max?: number;
}

export interface Ingredient {
  line: number;
  name: string;
  note?: string;
  amount?: Range;
  /** normalised unit as written (g, kg, ml, l, EL, TL, Prise, Päckchen, …); undefined for plain counts ("3 Eier") */
  unit?: string;
  /** explicit total weight in grams ("= 150 g") */
  grams?: number;
  tip?: string;
  approx?: boolean;
}

export interface Timer {
  line: number;
  /** seconds until the alarm (lower bound of a range) */
  seconds: number;
  /** duration as written, e.g. "10–12 min" */
  label: string;
  /** what to do when it rings, e.g. "Brot aus dem Ofen nehmen" */
  text: string;
}

export interface Step {
  line: number;
  ingredients: Ingredient[];
  /** instruction text with inline markup ([anchor]{tip}, **bold**) */
  text: string;
  callouts: string[];
  timers: Timer[];
}

export interface Section {
  title?: string;
  line: number;
  steps: Step[];
}

export interface Recipe {
  title: string;
  subtitle?: string;
  yield?: { amount: number; unit: string };
  yieldText?: string;
  time?: string;
  tags: string[];
  equipment: string[];
  note?: string;
  origin?: string;
  sections: Section[];
}

export interface Problem {
  line: number;
  message: string;
}

export interface Parsed {
  recipe: Recipe;
  errors: Problem[];
  warnings: Problem[];
}

const HEADER_KEYS: Record<string, keyof Recipe | 'yield'> = {
  untertitel: 'subtitle',
  ergibt: 'yield',
  zeit: 'time',
  schlagworte: 'tags',
  geräte: 'equipment',
  hinweis: 'note',
  herkunft: 'origin',
};

/** units with their kind; keys are lower-case spellings, values the normalised singular */
export const UNITS: Record<string, { unit: string; kind: 'mass' | 'volume' | 'count' }> = {
  g: { unit: 'g', kind: 'mass' },
  kg: { unit: 'kg', kind: 'mass' },
  ml: { unit: 'ml', kind: 'volume' },
  l: { unit: 'l', kind: 'volume' },
  el: { unit: 'EL', kind: 'volume' },
  tl: { unit: 'TL', kind: 'volume' },
  tasse: { unit: 'Tasse', kind: 'volume' },
  tassen: { unit: 'Tasse', kind: 'volume' },
  msp: { unit: 'Msp.', kind: 'volume' },
  'msp.': { unit: 'Msp.', kind: 'volume' },
  prise: { unit: 'Prise', kind: 'count' },
  prisen: { unit: 'Prise', kind: 'count' },
  päckchen: { unit: 'Päckchen', kind: 'count' },
  pck: { unit: 'Päckchen', kind: 'count' },
  'pck.': { unit: 'Päckchen', kind: 'count' },
  zehe: { unit: 'Zehe', kind: 'count' },
  zehen: { unit: 'Zehe', kind: 'count' },
  würfel: { unit: 'Würfel', kind: 'count' },
  blatt: { unit: 'Blatt', kind: 'count' },
  blätter: { unit: 'Blatt', kind: 'count' },
  bund: { unit: 'Bund', kind: 'count' },
  zweig: { unit: 'Zweig', kind: 'count' },
  zweige: { unit: 'Zweig', kind: 'count' },
  dose: { unit: 'Dose', kind: 'count' },
  dosen: { unit: 'Dose', kind: 'count' },
  becher: { unit: 'Becher', kind: 'count' },
  scheibe: { unit: 'Scheibe', kind: 'count' },
  scheiben: { unit: 'Scheibe', kind: 'count' },
  stück: { unit: 'Stück', kind: 'count' },
  stk: { unit: 'Stück', kind: 'count' },
  'stk.': { unit: 'Stück', kind: 'count' },
  handvoll: { unit: 'Handvoll', kind: 'count' },
  glas: { unit: 'Glas', kind: 'count' },
  gläser: { unit: 'Glas', kind: 'count' },
  stange: { unit: 'Stange', kind: 'count' },
  stangen: { unit: 'Stange', kind: 'count' },
  knolle: { unit: 'Knolle', kind: 'count' },
  knollen: { unit: 'Knolle', kind: 'count' },
  spritzer: { unit: 'Spritzer', kind: 'count' },
  schuss: { unit: 'Schuss', kind: 'count' },
  tropfen: { unit: 'Tropfen', kind: 'count' },
  fläschchen: { unit: 'Fläschchen', kind: 'count' },
  ampulle: { unit: 'Ampulle', kind: 'count' },
  ampullen: { unit: 'Ampulle', kind: 'count' },
  tüte: { unit: 'Tüte', kind: 'count' },
  tüten: { unit: 'Tüte', kind: 'count' },
  packung: { unit: 'Packung', kind: 'count' },
  packungen: { unit: 'Packung', kind: 'count' },
};

const FRACTIONS: Record<string, number> = { '½': 0.5, '¼': 0.25, '¾': 0.75, '⅓': 1 / 3, '⅔': 2 / 3, '⅛': 0.125 };
const NUM = String.raw`(?:\d+(?:[.,]\d+)?\s*[½¼¾⅓⅔⅛]|\d+\/\d+|\d+(?:[.,]\d+)?|[½¼¾⅓⅔⅛])`;
const AMOUNT_RE = new RegExp(String.raw`^(ca\.\s*)?(${NUM})(?:\s*(?:–|-|bis)\s*(${NUM}))?(?=\s|$)`);
const GRAMS_RE = /\s*=\s*(\d+(?:[.,]\d+)?)\s*g\b/;
const URL_RE = /\b(https?:\/\/|www\.)\S+/i;

export function parseNumber(s: string): number {
  const t = s.replace(/\s+/g, '');
  const frac = t.slice(-1);
  if (FRACTIONS[frac] !== undefined) {
    const whole = t.slice(0, -1);
    return (whole ? Number(whole.replace(',', '.')) : 0) + FRACTIONS[frac];
  }
  if (t.indexOf('/') > 0) {
    const [a, b] = t.split('/');
    return Number(a) / Number(b);
  }
  return Number(t.replace(',', '.'));
}

/** "1 h 30 min", "45 min", "10–12 min", "90 s" → seconds (lower bound) and the duration as written */
export function parseDuration(s: string): { seconds: number; label: string; rest: string } | null {
  const re = /^\s*(\d+(?:[.,]\d+)?)(?:\s*(?:–|-|bis)\s*(\d+(?:[.,]\d+)?))?\s*(h|std\.?|stunden?|min\.?|minuten?|s|sek\.?|sekunden?)(?=[\s–—:·|,-]|$)/i;
  let rest = s;
  let seconds = 0;
  const parts: string[] = [];
  for (;;) {
    const m = re.exec(rest);
    if (!m) break;
    const u = m[3].toLowerCase();
    const k = u.startsWith('h') || u.startsWith('st') ? 3600 : u.startsWith('m') ? 60 : 1;
    seconds += Number(m[1].replace(',', '.')) * k;
    parts.push(m[0].trim());
    rest = rest.slice(m[0].length);
  }
  if (!parts.length || seconds <= 0) return null;
  return { seconds: Math.round(seconds), label: parts.join(' '), rest: rest.replace(/^\s*[–—:·|-]?\s*/, '') };
}

function splitTip(s: string): { body: string; tip?: string } {
  const m = /\{([^{}]*)\}\s*$/.exec(s);
  if (!m || m.index === undefined) return { body: s };
  return { body: s.slice(0, m.index).trimEnd(), tip: m[1].trim() };
}

export function parseIngredient(raw: string, line: number, problems: Problem[]): Ingredient {
  let { body, tip } = splitTip(raw.trim());
  const ing: Ingredient = { line, name: '' };
  if (tip) ing.tip = tip;
  const g = GRAMS_RE.exec(body);
  if (g && g.index !== undefined) {
    ing.grams = parseNumber(g[1]);
    body = (body.slice(0, g.index) + body.slice(g.index + g[0].length)).trim();
  }
  const a = AMOUNT_RE.exec(body);
  if (a) {
    ing.amount = { min: parseNumber(a[2]) };
    if (a[3]) ing.amount.max = parseNumber(a[3]);
    if (a[1]) ing.approx = true;
    body = body.slice(a[0].length).trim();
    const word = /^(\S+)/.exec(body);
    if (word) {
      const u = UNITS[word[1].toLowerCase()];
      if (u && (u.kind !== 'count' || body.length > word[1].length)) {
        ing.unit = u.unit;
        body = body.slice(word[1].length).trim();
      }
    }
    if (!isFinite(ing.amount.min) || (ing.amount.max !== undefined && !isFinite(ing.amount.max))) problems.push({ line, message: 'Menge nicht lesbar: ' + raw });
  }
  const comma = body.indexOf(',');
  if (comma >= 0) {
    ing.name = body.slice(0, comma).trim();
    const note = body.slice(comma + 1).trim();
    if (note) ing.note = note;
  } else ing.name = body.trim();
  if (!ing.name) problems.push({ line, message: 'Zutat ohne Namen: ' + raw });
  return ing;
}

export function parse(source: string): Parsed {
  const errors: Problem[] = [];
  const warnings: Problem[] = [];
  const recipe: Recipe = { title: '', tags: [], equipment: [], sections: [] };
  const lines = source.replace(/\r\n?/g, '\n').split('\n');
  let i = 0;
  while (i < lines.length && !lines[i].trim()) i++;
  const first = lines[i] || '';
  if (/^#\s+\S/.test(first)) {
    recipe.title = first.replace(/^#\s+/, '').trim();
    i++;
  } else errors.push({ line: i + 1, message: 'Die erste Zeile muss der Titel sein: „# Name des Rezepts“.' });

  // header: "Key: value" lines until the first blank line
  for (; i < lines.length && lines[i].trim(); i++) {
    const l = lines[i].trim();
    if (l.startsWith('#')) break;
    const m = /^([A-Za-zÄÖÜäöüß]+)\s*:\s*(.*)$/.exec(l);
    const key = m ? HEADER_KEYS[m[1].toLowerCase()] : undefined;
    if (!m || !key) {
      errors.push({ line: i + 1, message: 'Unbekannte Kopfzeile: „' + l + '“ (erlaubt: Untertitel, Ergibt, Zeit, Schlagworte, Geräte, Hinweis, Herkunft). Nach dem Kopf eine Leerzeile.' });
      continue;
    }
    const v = m[2].trim();
    if (key === 'yield') {
      recipe.yieldText = v;
      const y = new RegExp(String.raw`^(${NUM})\s+(.+)$`).exec(v);
      if (y) recipe.yield = { amount: parseNumber(y[1]), unit: y[2].trim() };
      else warnings.push({ line: i + 1, message: '„Ergibt“ ohne Zahl – Mengen lassen sich dann nicht umrechnen.' });
    } else if (key === 'tags' || key === 'equipment') {
      recipe[key] = v.split(/\s*[,;]\s*/).filter(Boolean);
    } else (recipe as unknown as Record<string, string>)[key] = v;
  }

  let section: Section | null = null;
  let step: Step | null = null;
  const textParts: string[][] = [];
  const closeStep = () => {
    if (step) {
      step.text = (textParts.pop() || []).join(' ').trim();
      if (!step.text && !step.ingredients.length && !step.callouts.length && !step.timers.length) (section as Section).steps.pop();
    }
    step = null;
  };
  for (; i < lines.length; i++) {
    const raw = lines[i];
    const l = raw.trim();
    const n = i + 1;
    if (!l) {
      closeStep();
      continue;
    }
    if (l.startsWith('## ')) {
      closeStep();
      section = { title: l.slice(3).trim(), line: n, steps: [] };
      recipe.sections.push(section);
      continue;
    }
    if (l.startsWith('#')) {
      errors.push({ line: n, message: 'Überschriften im Rezept mit „## “ (zwei Rauten und Leerzeichen).' });
      continue;
    }
    if (!section) {
      section = { line: n, steps: [] };
      recipe.sections.push(section);
    }
    if (!step) {
      step = { line: n, ingredients: [], text: '', callouts: [], timers: [] };
      section.steps.push(step);
      textParts.push([]);
    }
    const s = step as Step;
    if (/^[-•*]\s+/.test(l)) s.ingredients.push(parseIngredient(l.replace(/^[-•*]\s+/, ''), n, errors));
    else if (l.startsWith('! ')) s.callouts.push(l.slice(2).trim());
    else if (/^timer\s*:/i.test(l)) {
      const d = parseDuration(l.replace(/^timer\s*:/i, ''));
      if (!d) errors.push({ line: n, message: 'Timer ohne Dauer: „' + l + '“ (z. B. „Timer: 45 min – Brot aus dem Ofen nehmen“).' });
      else {
        if (!d.rest) warnings.push({ line: n, message: 'Timer ohne Text – was soll beim Klingeln passieren?' });
        s.timers.push({ line: n, seconds: d.seconds, label: d.label, text: d.rest || 'Zeit ist um' });
      }
    } else textParts[textParts.length - 1].push(l);
    if (URL_RE.test(l)) errors.push({ line: n, message: 'Bitte keine Links im Rezept.' });
  }
  closeStep();

  if (!recipe.sections.some((sec) => sec.steps.length)) errors.push({ line: lines.length, message: 'Das Rezept hat noch keine Schritte.' });
  for (const sec of recipe.sections) {
    for (const st of sec.steps) {
      checkMarkup(st.text, st.line, errors);
      if (!st.text && !st.callouts.length && !st.timers.length) warnings.push({ line: st.line, message: 'Schritt nur mit Zutaten, ohne Anweisung.' });
      for (const ing of st.ingredients) {
        if (ing.unit && UNITS[ing.unit.toLowerCase()].kind === 'volume' && ing.grams === undefined)
          warnings.push({ line: ing.line, message: `„${ing.name}“: Mengen bitte in Gramm angeben (${ing.unit} lässt sich in der App anzeigen).` });
      }
    }
  }
  if (URL_RE.test(recipe.origin || '') || URL_RE.test(recipe.note || '')) errors.push({ line: 1, message: 'Bitte keine Links im Rezept.' });
  return { recipe, errors, warnings };
}

function checkMarkup(text: string, line: number, errors: Problem[]): void {
  let depth = 0;
  for (const c of text) {
    if (c === '{') depth++;
    if (c === '}') depth--;
    if (depth < 0 || depth > 1) break;
  }
  if (depth !== 0) errors.push({ line, message: 'Geschweifte Klammern { } passen nicht zusammen.' });
  if ((text.match(/\*\*/g) || []).length % 2) errors.push({ line, message: '„**“ für Fettdruck muss paarweise stehen.' });
}

export type Inline = { t: 'text'; s: string } | { t: 'bold'; s: string } | { t: 'tip'; s: string; tip: string };

/** step text → segments: plain text, **bold**, [anchor]{tip} and a trailing {tip} without anchor (s = '') */
export function inline(text: string): Inline[] {
  const out: Inline[] = [];
  const re = /\[([^\]]+)\]\{([^}]*)\}|\*\*([^*]+)\*\*|\{([^}]*)\}/g;
  let last = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > last) out.push({ t: 'text', s: text.slice(last, m.index) });
    if (m[1] !== undefined) out.push({ t: 'tip', s: m[1], tip: m[2].trim() });
    else if (m[3] !== undefined) out.push({ t: 'bold', s: m[3] });
    else out.push({ t: 'tip', s: '', tip: (m[4] || '').trim() });
    last = m.index + m[0].length;
  }
  if (last < text.length) out.push({ t: 'text', s: text.slice(last) });
  return out;
}

/** step text without markup (for notifications, summaries, plain output) */
export function plain(text: string): string {
  return inline(text)
    .map((x) => x.s)
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
}

/** all steps in order with their running number */
export function allSteps(r: Recipe): { step: Step; section: Section; n: number }[] {
  const out: { step: Step; section: Section; n: number }[] = [];
  for (const section of r.sections) for (const step of section.steps) out.push({ step, section, n: out.length + 1 });
  return out;
}

/** a minimal starting point for a new recipe */
export const TEMPLATE = `# Neues Rezept
Untertitel: in einem Satz, was es ist
Ergibt: 4 Portionen
Zeit: 30 min
Schlagworte: Kochen
Geräte: Topf, Schüssel

- 200 g Zutat
Was mit der Zutat passiert. [Wichtiges Detail]{Warum das genau hier wichtig ist.}

- 2 Eier = 100 g
Nächster Schritt.
Timer: 10 min – Was zu tun ist, wenn der Timer klingelt
`;
