import assert from 'node:assert/strict';
import { test } from 'node:test';
import { allSteps, inline, parse, parseDuration, parseIngredient, plain, type Problem } from '../../src/recipe/format.ts';
import { amountText, choices, fmtFraction, fmtGrams, gramsOf, show } from '../../src/recipe/units.ts';

const SAMPLE = `# Probierteig
Untertitel: nur für Tests
Ergibt: 4 Portionen
Zeit: 20 min
Schlagworte: Test, Backen
Geräte: Schüssel, Schneebesen

## Teig

- 250 g Weizenmehl Type 405 {Feiner Teig.}
- 2 Eier = 100 g, zimmerwarm
- 1 Prise Salz
Mehl [sieben]{Klümpchen lösen sich sonst nicht.} und mit den Eiern **glatt** rühren.
! Teig nicht zu lange rühren.
Timer: 10–12 min – Teig prüfen

## Backen

- 30 g Butter
Butter in der Pfanne schmelzen.
Timer: 1 h 30 min – Pfanne vom Herd nehmen
`;

test('parses header, sections, steps, ingredients, callouts and timers', () => {
  const { recipe, errors, warnings } = parse(SAMPLE);
  assert.deepEqual(errors, []);
  assert.deepEqual(warnings, []);
  assert.equal(recipe.title, 'Probierteig');
  assert.equal(recipe.subtitle, 'nur für Tests');
  assert.deepEqual(recipe.yield, { amount: 4, unit: 'Portionen' });
  assert.deepEqual(recipe.tags, ['Test', 'Backen']);
  assert.deepEqual(recipe.equipment, ['Schüssel', 'Schneebesen']);
  assert.equal(recipe.sections.length, 2);
  const [a, b] = recipe.sections;
  assert.equal(a.title, 'Teig');
  assert.equal(a.steps.length, 1);
  const s = a.steps[0];
  assert.equal(s.ingredients.length, 3);
  assert.deepEqual(s.ingredients[0], { line: 10, name: 'Weizenmehl Type 405', amount: { min: 250 }, unit: 'g', tip: 'Feiner Teig.' });
  assert.deepEqual(s.ingredients[1], { line: 11, name: 'Eier', note: 'zimmerwarm', amount: { min: 2 }, grams: 100 });
  assert.equal(s.ingredients[2].unit, 'Prise');
  assert.equal(s.text, 'Mehl [sieben]{Klümpchen lösen sich sonst nicht.} und mit den Eiern **glatt** rühren.');
  assert.deepEqual(s.callouts, ['Teig nicht zu lange rühren.']);
  assert.deepEqual(s.timers, [{ line: 15, seconds: 600, label: '10–12 min', text: 'Teig prüfen' }]);
  assert.equal(b.steps[0].timers[0].seconds, 5400);
  assert.equal(allSteps(recipe).length, 2);
});

test('inline markup and plain text', () => {
  assert.deepEqual(inline('Mehl [sieben]{weil} und **gut** rühren {am Ende}'), [
    { t: 'text', s: 'Mehl ' },
    { t: 'tip', s: 'sieben', tip: 'weil' },
    { t: 'text', s: ' und ' },
    { t: 'bold', s: 'gut' },
    { t: 'text', s: ' rühren ' },
    { t: 'tip', s: '', tip: 'am Ende' },
  ]);
  assert.equal(plain('Mehl [sieben]{weil} und **gut** rühren.'), 'Mehl sieben und gut rühren.');
});

test('ingredient lines', () => {
  const p: Problem[] = [];
  assert.deepEqual(parseIngredient('1½ Würfel Hefe', 1, p), { line: 1, name: 'Hefe', amount: { min: 1.5 }, unit: 'Würfel' });
  assert.deepEqual(parseIngredient('7–15 g Salz', 1, p), { line: 1, name: 'Salz', amount: { min: 7, max: 15 }, unit: 'g' });
  assert.deepEqual(parseIngredient('ca. 0,5 l Milch', 1, p), { line: 1, name: 'Milch', amount: { min: 0.5 }, unit: 'l', approx: true });
  assert.deepEqual(parseIngredient('Salz, nach Geschmack', 1, p), { line: 1, name: 'Salz', note: 'nach Geschmack' });
  assert.deepEqual(parseIngredient('1/2 TL Zimt', 1, p), { line: 1, name: 'Zimt', amount: { min: 0.5 }, unit: 'TL' });
  assert.deepEqual(parseIngredient('2 Würfel', 1, p), { line: 1, name: 'Würfel', amount: { min: 2 } });
  assert.deepEqual(p, []);
});

test('durations', () => {
  assert.equal(parseDuration('45 min – Brot raus')?.seconds, 2700);
  assert.equal(parseDuration('45 min – Brot raus')?.rest, 'Brot raus');
  assert.equal(parseDuration('2 Std. Teig ruhen')?.seconds, 7200);
  assert.equal(parseDuration('90 s: umrühren')?.rest, 'umrühren');
  assert.equal(parseDuration('Brot'), null);
});

test('errors and warnings', () => {
  const r = parse('Kein Titel\n\n- 2 EL Öl\n');
  assert.ok(r.errors.some((e) => /Titel/.test(e.message)));
  const w = parse('# X\n\n- 2 EL Milch\nRühren.\nSiehe https://example.org\n');
  assert.ok(w.warnings.some((e) => /Gramm/.test(e.message)));
  assert.ok(w.errors.some((e) => /Links/.test(e.message)));
  assert.ok(parse('# X\nFoo: bar\n\nRühren.').errors.some((e) => /Kopfzeile/.test(e.message)));
  assert.ok(parse('# X\n\nTimer: bald\n').errors.some((e) => /Dauer/.test(e.message)));
  assert.ok(parse('# X\n\nMehl [sieben]{weil.\n').errors.some((e) => /Klammern/.test(e.message)));
});

test('grams by default, counts for countable things', () => {
  const p: Problem[] = [];
  const flour = parseIngredient('250 g Weizenmehl', 1, p);
  assert.equal(amountText(flour, 1), '250 g');
  assert.equal(amountText(flour, 0.5), '125 g');
  assert.equal(choices(flour)[0], 'g');
  assert.ok(choices(flour).includes('ml'));
  assert.equal(amountText(flour, 1, 'ml'), '≈ 455 ml');
  const eggs = parseIngredient('3 Eier', 1, p);
  assert.deepEqual(choices(eggs), ['count', 'g']);
  assert.equal(amountText(eggs, 1), '3');
  assert.equal(show(eggs, 1).name, 'Eier');
  assert.equal(show(eggs, 1 / 3).name, 'Ei');
  assert.equal(show(eggs, 0.5).qty, '1½');
  assert.equal(amountText(eggs, 1, 'g'), '≈ 150 g');
  const weighed = parseIngredient('3 Eier = 165 g', 1, p);
  assert.equal(amountText(weighed, 1, 'g'), '165 g');
  const sugar = parseIngredient('1 Päckchen Vanillezucker', 1, p);
  assert.equal(amountText(sugar, 2), '2 Päckchen');
  assert.equal(amountText(sugar, 2, 'g'), '≈ 16 g');
  const salt = parseIngredient('6 g Salz', 1, p);
  assert.equal(amountText(salt, 1, 'TL'), '≈ 1 TL');
  assert.ok(choices(salt).includes('TL'));
  const pinch = parseIngredient('1 Prise Salz', 1, p);
  assert.equal(amountText(pinch, 2), '2 Prisen');
  const oil = parseIngredient('30 g Olivenöl', 1, p);
  assert.equal(amountText(oil, 1, 'EL'), '≈ 2 EL');
  const range = parseIngredient('7–15 g Salz', 1, p);
  assert.equal(amountText(range, 2), '14–30 g');
  const free = parseIngredient('Pfeffer, frisch gemahlen', 1, p);
  assert.equal(amountText(free, 2), '');
  assert.equal(Math.round((gramsOf(parseIngredient('2 EL Milch', 1, p)) as number) * 10) / 10, 30.9);
});

test('number formatting', () => {
  assert.equal(fmtGrams(2.25), '2,3');
  assert.equal(fmtGrams(312.4), '312');
  assert.equal(fmtGrams(1232), '1.230');
  assert.equal(fmtFraction(1.5), '1½');
  assert.equal(fmtFraction(0.25), '¼');
  assert.equal(fmtFraction(2), '2');
  assert.equal(fmtFraction(0.1), '¼');
});
