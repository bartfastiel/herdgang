// Checks recipe source files (Herdgang text) and prints problems; with --show also a two-column preview
// (ingredients next to the step that uses them), the way the app lays a recipe out.
//   node tools/check-recipes.ts [--show] <file|dir> …
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { allSteps, parse, plain } from '../src/recipe/format.ts';
import { amountText } from '../src/recipe/units.ts';

const args = process.argv.slice(2);
const SHOW = args.includes('--show');
const files = args
  .filter((a) => !a.startsWith('--'))
  .flatMap((a) => (statSync(a).isDirectory() ? readdirSync(a).filter((f) => f.endsWith('.txt')).map((f) => join(a, f)) : [a]));

let failed = 0;
const pad = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1) + '…' : s + ' '.repeat(n - s.length));
for (const file of files) {
  const { recipe, errors, warnings } = parse(readFileSync(file, 'utf8'));
  const steps = allSteps(recipe);
  const ingredients = steps.reduce((n, s) => n + s.step.ingredients.length, 0);
  const timers = steps.reduce((n, s) => n + s.step.timers.length, 0);
  const tips = steps.reduce((n, s) => n + (s.step.text.match(/\{/g) || []).length + s.step.ingredients.filter((i) => i.tip).length, 0);
  console.log(`${errors.length ? '✖' : '✔'} ${file}: „${recipe.title}“ – ${steps.length} Schritte, ${ingredients} Zutaten, ${timers} Timer, ${tips} Infos`);
  for (const e of errors) console.log(`    Fehler Zeile ${e.line}: ${e.message}`);
  for (const w of warnings) console.log(`    Hinweis Zeile ${w.line}: ${w.message}`);
  if (errors.length) failed++;
  if (!SHOW) continue;
  console.log('');
  for (const { step, section, n } of steps) {
    if (section.title && section.steps[0] === step) console.log(`  == ${section.title} ==`);
    const left = step.ingredients.map((i) => [amountText(i, 1), i.name].filter(Boolean).join(' ') + (i.note ? ', ' + i.note : ''));
    const right = [`${n}. ${plain(step.text)}`, ...step.callouts.map((c) => '! ' + c), ...step.timers.map((t) => `⏱ ${t.label} – ${t.text}`)];
    const words = right.join(' | ').split(' ');
    const lines: string[] = [];
    let cur = '';
    for (const w of words) {
      if ((cur + ' ' + w).length > 70) (lines.push(cur), (cur = w));
      else cur = cur ? cur + ' ' + w : w;
    }
    if (cur) lines.push(cur);
    for (let k = 0; k < Math.max(left.length, lines.length); k++) console.log('  ' + pad(left[k] || '', 34) + ' │ ' + (lines[k] || ''));
    console.log('  ' + '-'.repeat(34) + '─┼─');
  }
  console.log('');
}
if (failed) process.exitCode = 1;
