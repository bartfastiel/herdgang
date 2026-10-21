// A recipe as PDF for printing, laid out like the app: per step the ingredients (in the order they go in) next to the
// instruction; steps without ingredients use the full width. It should fit on one A4 page (Daniel's wish): the layout
// is tried with the explanations first, then without them, then a little smaller, then without subtitle and equipment
// (larger type matters more at the stove), then smaller still. Only a recipe that is still too long gets a second
// page.
import { allSteps, inline, type Recipe } from '../recipe/format.ts';
import { show, type Choice } from '../recipe/units.ts';
import { Pdf, wrap, wrapRuns, width, type Rgb, type Run } from './pdf.ts';

const ACCENT: Rgb = [63, 107, 58];
const TOMATO: Rgb = [176, 58, 36];
const INK: Rgb = [33, 29, 25];
const MUTED: Rgb = [110, 102, 94];
const RULE: Rgb = [222, 214, 200];
const NOTE_BG: Rgb = [246, 240, 228];

export interface PdfOptions {
  factor: number;
  /** chosen display unit per ingredient line number */
  choices?: Record<number, Choice>;
  version: number;
  date: number;
  yieldText?: string;
  /** a short block after the steps (src/views/nutrition.ts) */
  nutrition?: { title: string; text: string; source: string };
}

interface Fit {
  scale: number;
  /** the explanations („i“) as small notes under the steps */
  tips: boolean;
  /** subtitle and equipment (the recipe's note always stays) */
  extras: boolean;
}

const TRIES: Fit[] = [
  { scale: 1, tips: true, extras: true },
  { scale: 1, tips: false, extras: true },
  { scale: 0.92, tips: false, extras: true },
  { scale: 0.92, tips: false, extras: false },
  { scale: 0.85, tips: false, extras: false },
  { scale: 0.78, tips: false, extras: false },
  { scale: 0.72, tips: false, extras: false },
  { scale: 0.66, tips: false, extras: false },
];
const FALLBACK: Fit = { scale: 0.85, tips: false, extras: true };

export function recipePdf(r: Recipe, opts: PdfOptions): Uint8Array {
  for (const fit of TRIES) {
    const pdf = layout(r, opts, fit);
    if (pdf.pageCount === 1) return pdf.bytes();
  }
  return layout(r, opts, FALLBACK).bytes();
}

/** how the PDF of this recipe turns out: pages, type scale, what is left out (for tests and tools) */
export function pdfFit(r: Recipe, opts: PdfOptions): Fit & { pages: number } {
  for (const fit of TRIES) if (layout(r, opts, fit).pageCount === 1) return { ...fit, pages: 1 };
  return { ...FALLBACK, pages: layout(r, opts, FALLBACK).pageCount };
}

function layout(r: Recipe, opts: PdfOptions, fit: Fit): Pdf {
  const k = fit.scale;
  const pdf = new Pdf();
  pdf.title = r.title;
  const M = 34;
  const W = pdf.w - 2 * M;
  const BOTTOM = pdf.h - 36;
  const size = { title: 20 * k, sub: 10.5 * k, meta: 8.5 * k, head: 12 * k, ing: 9 * k, text: 10 * k, extra: 9 * k, note: 8 * k };
  const lh = (s: number) => s * 1.3;
  const GUT = 22 * k;
  const LX = M + GUT;
  const LEFT = 150 * k;
  const RX = LX + LEFT + 12 * k;
  let y = M;

  const newPage = () => {
    pdf.addPage();
    y = M;
    pdf.text(M, y + size.meta, r.title + ' (Fortsetzung)', 'B', size.meta, MUTED);
    y += lh(size.meta) + 8 * k;
  };

  // title block: title, subtitle, yield · time · version, equipment, note
  for (const l of wrap(r.title, 'B', size.title, W)) {
    pdf.text(M, y + size.title, l, 'B', size.title, INK);
    y += lh(size.title);
  }
  if (fit.extras && r.subtitle) {
    for (const l of wrap(r.subtitle, 'R', size.sub, W)) {
      pdf.text(M, y + size.sub, l, 'R', size.sub, MUTED);
      y += lh(size.sub);
    }
  }
  y += 3 * k;
  const meta = [opts.yieldText ? 'Ergibt ' + opts.yieldText : '', r.time ? 'Zeit: ' + r.time : '', `Version ${opts.version} vom ${new Date(opts.date).toLocaleDateString('de-DE')}`].filter(Boolean);
  for (const l of wrap(meta.join('   ·   '), 'R', size.meta, W)) {
    pdf.text(M, y + size.meta, l, 'R', size.meta, MUTED);
    y += lh(size.meta);
  }
  if (fit.extras && r.equipment.length) {
    for (const line of wrapRuns([{ s: 'Geräte: ', font: 'B' }, { s: r.equipment.join(', '), font: 'R' }], size.meta, W)) {
      pdf.runs(M, y + size.meta, line, size.meta, INK);
      y += lh(size.meta);
    }
  }
  if (r.note) {
    const lines = wrapRuns([{ s: 'Hinweis: ', font: 'B' }, { s: r.note, font: 'R' }], size.extra, W - 12 * k);
    y += 4 * k;
    pdf.rect(M, y, W, lines.length * lh(size.extra) + 8 * k, NOTE_BG);
    y += 4 * k;
    for (const line of lines) {
      pdf.runs(M + 6 * k, y + size.extra, line, size.extra, INK);
      y += lh(size.extra);
    }
    y += 4 * k;
  }
  y += 8 * k;

  const steps = allSteps(r);
  const amountOf = (ing: Parameters<typeof show>[0]) => {
    const s = show(ing, opts.factor, opts.choices ? opts.choices[ing.line] : undefined);
    return { s, amount: [s.qty, s.unit].filter(Boolean).join(' ') };
  };
  // the amount column is as wide as the widest amount (within limits), the names use the rest
  const AW = Math.min(76 * k, Math.max(26 * k, ...steps.flatMap((x) => x.step.ingredients.map((ing) => width(amountOf(ing).amount, 'B', size.ing)))));
  for (const { step, section, n } of steps) {
    const left = step.ingredients.map((ing) => {
      const { s, amount } = amountOf(ing);
      return { amount, name: wrap(s.name + (ing.note ? ', ' + ing.note : ''), 'R', size.ing, LEFT - AW - 5 * k) };
    });
    const leftH = left.reduce((hh, l) => hh + l.name.length * lh(size.ing) + 2 * k, 0);

    // text, warnings, timers and (if there is room) the explanations; full width when there are no ingredients
    const tx = left.length ? RX : LX;
    const tw = M + W - tx;
    const runs: Run[] = [];
    const notes: Run[][] = [];
    for (const seg of inline(step.text)) {
      if (seg.t === 'bold') runs.push({ s: seg.s, font: 'B' });
      else if (seg.t === 'tip') {
        if (seg.s) runs.push({ s: seg.s, font: 'R' });
        if (fit.tips) notes.push(seg.s ? [{ s: seg.s + ': ', font: 'B' }, { s: seg.tip, font: 'I' }] : [{ s: seg.tip, font: 'I' }]);
      } else runs.push({ s: seg.s, font: 'R' });
    }
    if (fit.tips) for (const ing of step.ingredients) if (ing.tip) notes.push([{ s: ing.name + ': ', font: 'B' }, { s: ing.tip, font: 'I' }]);
    const textLines = runs.length ? wrapRuns(runs, size.text, tw) : [];
    const extras = [
      ...step.callouts.map((c) => wrapRuns([{ s: '! ' + c, font: 'B', color: TOMATO }], size.extra, tw)),
      ...step.timers.map((t) => wrapRuns([{ s: 'Timer ' + t.label + ': ', font: 'B', color: ACCENT }, { s: t.text, font: 'R', color: ACCENT }], size.extra, tw)),
    ];
    const noteLines = notes.map((nl) => wrapRuns(nl, size.note, tw - 8 * k));
    const rightH =
      textLines.length * lh(size.text) +
      extras.reduce((a, c) => a + c.length * lh(size.extra) + 2 * k, 0) +
      noteLines.reduce((a, c) => a + c.length * lh(size.note) + 1 * k, 0) +
      (noteLines.length ? 3 * k : 0);
    const stepH = Math.max(leftH, rightH, 16 * k) + 8 * k;
    const heading = section.title && section.steps[0] === step ? lh(size.head) + 6 * k : 0;
    if (y + heading + stepH > BOTTOM && y > M + 40) newPage();
    if (heading) {
      pdf.text(M, y + size.head, section.title as string, 'B', size.head, ACCENT);
      pdf.line(M, y + lh(size.head) + 1 * k, M + W, y + lh(size.head) + 1 * k, 0.7, ACCENT);
      y += heading;
    }
    const top = y;
    // number in the gutter
    const R = 7 * k;
    pdf.circle(M + R, top + R, R, ACCENT);
    const label = String(n);
    pdf.text(M + R - width(label, 'B', 8 * k) / 2, top + R + 2.9 * k, label, 'B', 8 * k, [255, 255, 255]);
    // ingredients: amount right-aligned, then the name
    let ly = top;
    for (const l of left) {
      pdf.text(LX + AW - width(l.amount, 'B', size.ing), ly + size.ing, l.amount, 'B', size.ing, INK);
      l.name.forEach((nm, i) => pdf.text(LX + AW + 5 * k, ly + size.ing + i * lh(size.ing), nm, 'R', size.ing, INK));
      ly += l.name.length * lh(size.ing) + 2 * k;
    }
    let ry = top;
    for (const line of textLines) {
      pdf.runs(tx, ry + size.text, line, size.text, INK);
      ry += lh(size.text);
    }
    for (const c of extras) {
      ry += 2 * k;
      for (const line of c) {
        pdf.runs(tx, ry + size.extra, line, size.extra, INK);
        ry += lh(size.extra);
      }
    }
    if (noteLines.length) ry += 3 * k;
    for (const nl of noteLines) {
      pdf.text(tx, ry + size.note, '›', 'B', size.note, MUTED);
      for (const line of nl) {
        pdf.runs(tx + 8 * k, ry + size.note, line, size.note, MUTED);
        ry += lh(size.note);
      }
      ry += 1 * k;
    }
    y = top + stepH;
    pdf.line(M, y - 4 * k, M + W, y - 4 * k, 0.4, RULE);
  }

  if (opts.nutrition) {
    const nu = opts.nutrition;
    const lines = wrapRuns([{ s: nu.title + ': ', font: 'B', color: ACCENT }, { s: nu.text, font: 'R' }], size.note, W);
    const source = wrap(nu.source, 'R', 6.5, W);
    if (y + 4 * k + lines.length * lh(size.note) + source.length * 8.5 > BOTTOM) newPage();
    y += 2 * k;
    for (const line of lines) {
      pdf.runs(M, y + size.note, line, size.note, INK);
      y += lh(size.note);
    }
    for (const l of source) {
      pdf.text(M, y + 6.5, l, 'R', 6.5, MUTED);
      y += 8.5;
    }
  }

  const total = pdf.pageCount;
  for (let i = 0; i < total; i++) {
    pdf.onPage(i);
    const foot = `Herdgang · ${r.title} · Version ${opts.version}${opts.factor !== 1 ? ' · umgerechnet' : ''}`;
    pdf.text(M, pdf.h - 20, foot, 'R', 7, MUTED);
    if (total > 1) {
      const p = `Seite ${i + 1} von ${total}`;
      pdf.text(pdf.w - M - width(p, 'R', 7), pdf.h - 20, p, 'R', 7, MUTED);
    }
  }
  return pdf;
}
