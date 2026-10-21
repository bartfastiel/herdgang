import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import { KNOWN_FOODS } from '../../src/recipe/foods.ts';
import { allSteps, parse } from '../../src/recipe/format.ts';
import { bases, facts, fmtValue, foodKey, foodTable, matchFood, nameScore, perBasis, share, summary, type FoodFile } from '../../src/recipe/nutrition.ts';

const table = foodTable(JSON.parse(readFileSync(new URL('../../nutrition/bls.json', import.meta.url), 'utf8')) as FoodFile);

test('the table has the nutrients the app shows, and every listed food exists in it', () => {
  assert.ok(table.foods.length > 7000);
  assert.match(table.source, /Max Rubner-Institut/);
  assert.match(table.license, /CC BY 4\.0/);
  const butter = table.byCode.get('Q630000');
  assert.equal(butter?.name, 'Süßrahmbutter');
  assert.deepEqual(butter?.per100, [747, 82.5, 55.65, 0.6, 0.6, 0, 0.59, 0.03]);
  for (const [re, code] of KNOWN_FOODS) if (code) assert.ok(table.byCode.has(code), `${re}: ${code} missing in the table`);
});

test('ingredients find their food: list, cookbook choice, guess, not counted', () => {
  assert.equal(matchFood('Butter', table).food?.code, 'Q630000');
  assert.equal(matchFood('Butterschmalz', table).food?.code, 'Q683000');
  assert.equal(matchFood('Ei (Größe M)', table).food?.code, 'E111100');
  assert.equal(matchFood('Eier (Größe L)', table).food?.code, 'E111100');
  assert.equal(matchFood('Eigelb', table).food?.code, 'E112100');
  assert.equal(matchFood('Zuckerrübensirup', table).food?.code, 'S120000');
  assert.equal(matchFood('Kräuteressig', table).food?.code, 'R124000');
  assert.equal(matchFood('Zimt', table).how, 'skip');
  assert.equal(matchFood('Rum-Aroma', table).how, 'skip');
  assert.equal(matchFood('brauner Rum', table).food?.code, 'P741000');
  // not in the list: guessed by name, adjectives dropped
  const g = matchFood('frischer Blattspinat', table);
  assert.equal(g.how, 'guess');
  assert.match(g.food?.name || '', /spinat/i);
  assert.equal(matchFood('Xyzzy', table).how, 'none');
  // a choice in the cookbook wins; the edible share of a whole fish stays
  const chosen = { [foodKey('Doraden')]: 'T502100', [foodKey('Butter')]: '' };
  assert.deepEqual([matchFood('Doraden', table, chosen).food?.code, matchFood('Doraden', table, chosen).edible], ['T502100', 0.44]);
  assert.equal(matchFood('Butter', table, chosen).how, 'skip');
});

test('compound words: the head word counts', () => {
  assert.ok(nameScore('Trinkwasser', 'Wasser') > nameScore('Wassermelone roh', 'Wasser'));
  assert.equal(nameScore('Butter gesalzen', 'Margarine'), 0);
});

const RECIPE = `# Nudeln mit Butter
Ergibt: 4 Portionen

## Kochen

- 4000 g Wasser
- 40 g Salz
Den großen Topf mit Wasser und Salz aufsetzen.

- 400 g kurze Nudeln
Die Nudeln kochen und abgießen.

- 500 g Butterschmalz
Das Fett auf 170 °C erhitzen, es steht etwa 2 cm hoch.

- 50 g Butter
- 2 g Zimt
- Pfeffer, nach Geschmack
- 100 g Xyzzy
Alles mischen.

## Variante: mit Speck

- 100 g Speckwürfel
Den Speck dazugeben.
`;

test('cooking water and deep-frying fat count only in part', () => {
  const r = parse(RECIPE).recipe;
  const steps = allSteps(r).map((s) => s.step);
  assert.equal(share(steps[0].ingredients[1], steps[0]).factor, 0.1);
  assert.equal(share(steps[2].ingredients[0], steps[2]).factor, 0.1);
  assert.equal(share(steps[3].ingredients[0], steps[3]).factor, 1);
  const f = facts(r, table);
  const salt = f.lines.find((l) => l.ing.name === 'Salz');
  assert.equal(salt?.counted, 4);
  assert.match(salt?.why || '', /Kochwasser/);
  assert.deepEqual(f.skipped.map((l) => l.ing.name), ['Zimt']);
  assert.deepEqual(f.unweighed.map((l) => l.ing.name), ['Pfeffer']);
  assert.deepEqual(f.unmatched.map((l) => l.ing.name), ['Xyzzy']);
  assert.deepEqual(f.variants.map((l) => l.ing.name), ['Speckwürfel']);
  // 400 g pasta + 50 g butterschmalz + 50 g butter
  const kcal = (400 * 346 + 50 * 897 + 50 * 747) / 100;
  assert.ok(Math.abs(f.total[0] - kcal) < 0.01, String(f.total[0]));
  assert.ok(Math.abs(f.coverage - (4000 + 4 + 400 + 50 + 50) / (4000 + 4 + 400 + 50 + 50 + 100)) < 1e-9);
  // scaled to 8 portions the whole doubles, a portion stays the same
  const twice = facts(r, table, {}, 2);
  const [portion] = bases(r);
  assert.equal(portion.label, 'pro Portion');
  assert.ok(Math.abs(perBasis(twice.total, portion, 2)[0] - perBasis(f.total, portion, 1)[0]) < 1e-9);
  assert.equal(summary(f, r), '≈ ' + fmtValue('kcal', kcal / 4) + ' pro Portion');
});

test('values per portion or piece, per 100 g where the finished weight is known, otherwise in total', () => {
  const b = (y: string) => bases(parse(`# X\nErgibt: ${y}\n\n- 1 g Salz\nSalzen.\n`).recipe).map((x) => `${x.label}:${x.count}`);
  assert.deepEqual(b('4 Portionen'), ['pro Portion:4', 'gesamt:1']);
  assert.deepEqual(b('12 Scheiben'), ['pro Scheibe:12', 'gesamt:1']);
  assert.deepEqual(b('8 Brezen'), ['pro Breze:8', 'gesamt:1']);
  assert.deepEqual(b('4 Pizzen (je ca. 28 cm)'), ['pro Pizza:4', 'gesamt:1']);
  assert.deepEqual(b('450 g'), ['pro 100 g:4.5', 'gesamt:1']);
  assert.deepEqual(b('1 Brot (ca. 750 g)'), ['pro 100 g:7.5', 'gesamt:1']);
  assert.deepEqual(b('2 kleine Gläser (je etwa 150 g)'), ['pro Glas:2', 'pro 100 g:3']);
  assert.deepEqual(b('1 Obstboden (Ø 28 cm, etwa 12 Stück)'), ['pro Stück:12', 'gesamt:1']);
  assert.deepEqual(bases(parse('# X\n\n- 1 g Salz\nSalzen.\n').recipe).map((x) => x.label), ['gesamt']);
});

test('values are rounded like on a food label', () => {
  assert.equal(fmtValue('kcal', 1834.6), '1.835 kcal');
  assert.equal(fmtValue('fat', 23.4), '23 g');
  assert.equal(fmtValue('fat', 2.34), '2,3 g');
  assert.equal(fmtValue('sugar', 0.3), '< 0,5 g');
  assert.equal(fmtValue('saturated', 0.05), '< 0,1 g');
  assert.equal(fmtValue('salt', 1.26), '1,3 g');
  assert.equal(fmtValue('salt', 0.234), '0,23 g');
  assert.equal(fmtValue('salt', 0.01), '< 0,01 g');
});
