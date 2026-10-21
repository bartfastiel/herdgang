import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { invitePdf } from '../../src/pdf/invite-pdf.ts';
import { encode, wrap } from '../../src/pdf/pdf.ts';
import { pdfFit, recipePdf } from '../../src/pdf/recipe-pdf.ts';
import { qr } from '../../src/qr.ts';
import { changedAmounts, diffLines, shoppingList } from '../../src/recipe/compare.ts';
import { parse } from '../../src/recipe/format.ts';
import { amountText } from '../../src/recipe/units.ts';

const SAMPLE = readFileSync('tests/fixtures/sample.txt', 'utf8');

/** every object offset in the cross-reference table points at "<n> 0 obj" */
function checkPdf(bytes: Uint8Array): string {
  const s = Buffer.from(bytes).toString('latin1');
  assert.ok(s.startsWith('%PDF-1.4\n'));
  assert.ok(s.endsWith('%%EOF\n'));
  const xref = Number(/startxref\n(\d+)\n%%EOF\n$/.exec(s)?.[1]);
  assert.equal(s.slice(xref, xref + 4), 'xref');
  const count = Number(/xref\n0 (\d+)\n/.exec(s.slice(xref))?.[1]);
  const lines = s.slice(xref).split('\n').slice(3, 2 + count);
  lines.forEach((l, i) => {
    const off = Number(l.slice(0, 10));
    assert.equal(s.slice(off, off + String(i + 1).length + 6), `${i + 1} 0 obj`);
  });
  for (const m of s.matchAll(/<< \/Length (\d+) >>\nstream\n/g)) {
    const start = (m.index as number) + m[0].length;
    assert.equal(s.slice(start + Number(m[1]), start + Number(m[1]) + 10), '\nendstream');
  }
  return s;
}

test('recipe PDF is well-formed, scaled, and keeps umlauts', () => {
  const r = parse(SAMPLE).recipe;
  const s = checkPdf(recipePdf(r, { factor: 2, version: 3, date: Date.parse('2026-10-21'), yieldText: '8 Stück' }));
  assert.match(s, /\(250 g\) Tj/);
  assert.match(s, /\(4\) Tj/);
  assert.match(s, /Version 3/);
  assert.match(s, /einr\\374hren/);
  assert.match(s, /Timer 20 min: /);
  // fits on one page, with the explanations
  assert.deepEqual(pdfFit(r, { factor: 1, version: 1, date: 0 }), { scale: 1, tips: true, extras: true, pages: 1 });
});

test('a long recipe still fits on one A4 page: explanations out, then smaller type', () => {
  const step = (i: number) => `- ${i * 10} g Zutat ${i}, fein gehackt\nDen Teig [kräftig rühren]{Damit sich alles gut verbindet und keine Klümpchen bleiben.} und dann ${'sehr lange '.repeat(12)}weiterarbeiten.\nTimer: 5 min – weiter mit Schritt ${i + 1}\n`;
  const long = parse('# Lang\nErgibt: 4 Portionen\nHinweis: Am Vortag beginnen.\n\n' + Array.from({ length: 16 }, (_, i) => step(i + 1)).join('\n')).recipe;
  const fit = pdfFit(long, { factor: 1, version: 1, date: 0 });
  assert.equal(fit.pages, 1);
  assert.equal(fit.tips, false);
  assert.ok(fit.scale < 1);
  assert.match(checkPdf(recipePdf(long, { factor: 1, version: 1, date: 0 })), /Am Vortag beginnen/);
});

test('invite PDF carries the link and a QR code', () => {
  const link = 'https://herdgang.example.org/login/?invite=abc';
  const s = checkPdf(invitePdf({ name: 'Daniel', cookbook: 'Daniels Kochbuch', link, expires: Date.parse('2026-11-04') }));
  assert.match(s, /Einladung f\\374r Daniel/);
  assert.match(s, /invite=abc/);
  assert.ok((s.match(/ re f/g) || []).length > 200);
});

test('PDF text helpers', () => {
  assert.equal(encode('Größe ≈ ½ – €'), 'Gr\xf6\xdfe ca. \xbd \x96 \x80');
  assert.deepEqual(wrap('ein zwei drei vier fünf', 'R', 10, 50), ['ein zwei', 'drei vier', 'fünf']);
});

test('QR code: size, finder patterns and a stable matrix', () => {
  const m = qr('https://herdgang.example.org/login/?invite=AbCdEfGhIjKlMnOpQrStUv');
  assert.equal(m.length, 37);
  for (const [x, y] of [[0, 0], [30, 0], [0, 30]]) {
    assert.equal(m[y][x], true);
    assert.equal(m[y + 1][x + 1], false);
    assert.equal(m[y + 3][x + 3], true);
  }
  const bits = m.map((r) => r.map((b) => (b ? 1 : 0)).join('')).join('');
  // checked once against an independent decoder (zxing); this guards against regressions
  assert.equal(createHash('sha256').update(bits).digest('hex').slice(0, 16), '8d5d3d67e13bb667');
});

test('versions: line diff and changed amounts', () => {
  const a = SAMPLE;
  const b = SAMPLE.replace('- 250 g Milch', '- 270 g Milch').replace('- 10 g Butter\n', '');
  const d = diffLines(a, b);
  assert.deepEqual(d.filter((l) => l.t !== 'same'), [
    { t: 'del', s: '- 250 g Milch' },
    { t: 'add', s: '- 270 g Milch' },
    { t: 'del', s: '- 10 g Butter' },
  ]);
  assert.deepEqual(changedAmounts(parse(a).recipe, parse(b).recipe), ['Milch: 250 g → 270 g', 'entfällt: Butter']);
});

test('ingredient list sums the same ingredient across steps', () => {
  const r = parse('# X\n\n- 50 g Mehl\n- 1 Ei = 50 g\nA.\n\n- 0,45 kg Mehl\n- 2 Eier = 110 g\n- Salz\nB.\n').recipe;
  const list = shoppingList(r);
  assert.equal(list.length, 4);
  assert.equal(amountText(list[0].ingredient, 1), '500 g');
  assert.deepEqual(list[0].steps, [1, 2]);
  assert.equal(amountText(list[1].ingredient, 1), '1');
  assert.equal(amountText(list[2].ingredient, 1), '2');
  assert.equal(list[3].ingredient.name, 'Salz');
});
