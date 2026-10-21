// A recipe as PDF, laid out like the app: per step the ingredients on the left (in the order they go in) next to the
// instruction on the right. Info texts become small notes under the step, timers a line of their own.
import { allSteps, inline, type Recipe } from '../recipe/format.ts';
import { show, type Choice } from '../recipe/units.ts';
import { Pdf, wrap, wrapRuns, width, type Rgb, type Run } from './pdf.ts';

const ACCENT: Rgb = [63, 107, 58];
const TOMATO: Rgb = [176, 58, 36];
const INK: Rgb = [33, 29, 25];
const MUTED: Rgb = [110, 102, 94];
const RULE: Rgb = [222, 214, 200];

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

export function recipePdf(r: Recipe, opts: PdfOptions): Uint8Array {
  const pdf = new Pdf();
  pdf.title = r.title;
  const M = 42;
  const W = pdf.w - 2 * M;
  const LEFT = 168;
  const GAP = 16;
  const RX = M + LEFT + GAP;
  const RW = W - LEFT - GAP;
  const BOTTOM = pdf.h - 48;
  let y = M + 6;

  const newPage = () => {
    pdf.addPage();
    y = M;
    pdf.text(M, y + 10, r.title + ' (Fortsetzung)', 'B', 10, MUTED);
    y += 26;
  };

  // title block
  for (const l of wrap(r.title, 'B', 24, W)) {
    pdf.text(M, y + 22, l, 'B', 24, INK);
    y += 30;
  }
  if (r.subtitle) {
    for (const l of wrap(r.subtitle, 'R', 12, W)) {
      pdf.text(M, y + 12, l, 'R', 12, MUTED);
      y += 16;
    }
  }
  y += 6;
  const meta = [opts.yieldText ? 'Ergibt ' + opts.yieldText : '', r.time ? 'Zeit: ' + r.time : '', `Version ${opts.version} vom ${new Date(opts.date).toLocaleDateString('de-DE')}`].filter(Boolean);
  for (const l of wrap(meta.join('   ·   '), 'R', 9.5, W)) {
    pdf.text(M, y + 10, l, 'R', 9.5, MUTED);
    y += 13;
  }
  if (r.equipment.length) {
    for (const line of wrapRuns([{ s: 'Geräte: ', font: 'B' }, { s: r.equipment.join(', '), font: 'R' }], 9.5, W)) {
      pdf.runs(M, y + 10, line, 9.5, INK);
      y += 13;
    }
  }
  if (r.note) {
    const lines = wrapRuns([{ s: 'Hinweis: ', font: 'B' }, { s: r.note, font: 'R' }], 10, W - 16);
    pdf.rect(M, y + 4, W, lines.length * 14 + 10, [246, 240, 228]);
    y += 9;
    for (const line of lines) {
      pdf.runs(M + 8, y + 10, line, 10, INK);
      y += 14;
    }
    y += 6;
  }
  y += 10;

  const steps = allSteps(r);
  const amountOf = (ing: Parameters<typeof show>[0]) => {
    const s = show(ing, opts.factor, opts.choices ? opts.choices[ing.line] : undefined);
    return { s, amount: [s.qty, s.unit].filter(Boolean).join(' ') };
  };
  // the amount column is as wide as the widest amount (within limits), the names use the rest
  const AW = Math.min(84, Math.max(30, ...steps.flatMap((x) => x.step.ingredients.map((ing) => width(amountOf(ing).amount, 'B', 9.5)))));
  for (const { step, section, n } of steps) {
    // left column: amount (bold, right aligned) + name
    const left: { amount: string; name: string[] }[] = step.ingredients.map((ing) => {
      const { s, amount } = amountOf(ing);
      return { amount, name: wrap(s.name + (ing.note ? ', ' + ing.note : ''), 'R', 9.5, LEFT - AW - 6) };
    });
    const leftH = left.reduce((hh, l) => hh + l.name.length * 12 + 3, 0);

    // right column: text with bold parts, callouts, timers, notes
    const runs: Run[] = [];
    const notes: Run[][] = [];
    for (const seg of inline(step.text)) {
      if (seg.t === 'bold') runs.push({ s: seg.s, font: 'B' });
      else if (seg.t === 'tip') {
        if (seg.s) runs.push({ s: seg.s, font: 'R' });
        notes.push(seg.s ? [{ s: seg.s + ': ', font: 'B' }, { s: seg.tip, font: 'I' }] : [{ s: seg.tip, font: 'I' }]);
      } else runs.push({ s: seg.s, font: 'R' });
    }
    for (const ing of step.ingredients) if (ing.tip) notes.push([{ s: ing.name + ': ', font: 'B' }, { s: ing.tip, font: 'I' }]);
    const textLines = runs.length ? wrapRuns(runs, 10.5, RW - 26) : [];
    const callouts = step.callouts.map((c) => wrapRuns([{ s: '! ' + c, font: 'B', color: TOMATO }], 10, RW - 26));
    const timers = step.timers.map((t) => wrapRuns([{ s: 'Timer ' + t.label + ': ', font: 'B', color: ACCENT }, { s: t.text, font: 'R', color: ACCENT }], 10, RW - 26));
    const noteLines = notes.map((nl) => wrapRuns(nl, 8.5, RW - 34));
    const rightH =
      textLines.length * 14 + callouts.reduce((a, c) => a + c.length * 13 + 3, 0) + timers.reduce((a, c) => a + c.length * 13 + 3, 0) + noteLines.reduce((a, c) => a + c.length * 11 + 2, 0) + (noteLines.length ? 4 : 0);
    const stepH = Math.max(leftH, rightH, 20) + 14;
    const heading = section.title && section.steps[0] === step ? 30 : 0;
    if (y + heading + stepH > BOTTOM && y > M + 40) newPage();
    if (heading) {
      pdf.text(M, y + 16, section.title as string, 'B', 13, ACCENT);
      pdf.line(M, y + 22, M + W, y + 22, 0.8, ACCENT);
      y += heading;
    }
    const top = y;
    // ingredients
    let ly = top + 10;
    for (const l of left) {
      pdf.text(M + AW - width(l.amount, 'B', 9.5), ly, l.amount, 'B', 9.5, INK);
      l.name.forEach((nm, i) => pdf.text(M + AW + 6, ly + i * 12, nm, 'R', 9.5, INK));
      ly += l.name.length * 12 + 3;
    }
    // number
    pdf.circle(RX + 8, top + 6, 8, ACCENT);
    const label = String(n);
    pdf.text(RX + 8 - width(label, 'B', 9) / 2, top + 9.2, label, 'B', 9, [255, 255, 255]);
    let ry = top + 10;
    for (const line of textLines) {
      pdf.runs(RX + 24, ry, line, 10.5, INK);
      ry += 14;
    }
    for (const c of [...callouts, ...timers]) {
      ry += 3;
      for (const line of c) {
        pdf.runs(RX + 24, ry, line, 10, INK);
        ry += 13;
      }
    }
    if (noteLines.length) ry += 4;
    for (const nl of noteLines) {
      pdf.text(RX + 24, ry, '›', 'B', 8.5, MUTED);
      for (const line of nl) {
        pdf.runs(RX + 32, ry, line, 8.5, MUTED);
        ry += 11;
      }
      ry += 2;
    }
    y = top + stepH;
    pdf.line(M, y - 7, M + W, y - 7, 0.4, RULE);
  }

  if (opts.nutrition) {
    const n = opts.nutrition;
    const lines = wrap(n.text, 'R', 9.5, W);
    const source = wrap(n.source, 'R', 7.5, W);
    if (y + 26 + lines.length * 13 + source.length * 10 > BOTTOM) newPage();
    y += 4;
    pdf.text(M, y + 10, n.title, 'B', 10, ACCENT);
    y += 17;
    for (const l of lines) {
      pdf.text(M, y + 10, l, 'R', 9.5, INK);
      y += 13;
    }
    y += 3;
    for (const l of source) {
      pdf.text(M, y + 8, l, 'R', 7.5, MUTED);
      y += 10;
    }
  }

  const total = pdf.pageCount;
  for (let i = 0; i < total; i++) {
    pdf.onPage(i);
    const foot = `Herdgang · ${r.title} · Version ${opts.version}${opts.factor !== 1 ? ' · umgerechnet' : ''}`;
    pdf.text(M, pdf.h - 26, foot, 'R', 8, MUTED);
    const p = `Seite ${i + 1} von ${total}`;
    pdf.text(pdf.w - M - width(p, 'R', 8), pdf.h - 26, p, 'R', 8, MUTED);
  }
  return pdf.bytes();
}
