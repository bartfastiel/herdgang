import { expect, test, type Browser, type Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const BASE = 'http://localhost:4175';
const env = { ...process.env, DATA_DIR: 'test-results/e2e-data', ORIGIN: BASE };
const cli = (...args: string[]) => execFileSync('node', ['dist-server/cli.mjs', ...args], { env }).toString();
const SAMPLE = readFileSync('tests/fixtures/sample.txt', 'utf8');

async function signUp(browser: Browser, name: string, role: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/401/.test(m.text()) && errors.push(m.text()));
  (page as Page & { errors: string[] }).errors = errors;
  const cdp = await context.newCDPSession(page);
  await cdp.send('WebAuthn.enable');
  await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
  const link = cli('invite', '--cookbook', 'Testküche', '--name', name, '--role', role).split('\n')[0];
  await page.clock.install();
  await page.goto(link);
  await expect(page.getByRole('heading', { name: `Hallo ${name}!` })).toBeVisible();
  await expect(page.getByText('„Testküche“')).toBeVisible();
  await page.getByRole('button', { name: 'Passkey einrichten' }).click();
  await page.waitForURL(BASE + '/');
  return page;
}

async function noOverflow(page: Page): Promise<void> {
  expect(await page.evaluate(() => document.documentElement.scrollWidth)).toBeLessThanOrEqual(412);
}

test.beforeAll(() => {
  if (!cli('cookbooks').includes('Testküche')) cli('cookbook-create', '--name', 'Testküche');
});

test.describe.configure({ mode: 'serial' });

test('cooking with a recipe: amounts, info, timers, feedback, versions, PDF, invites', async ({ browser }) => {
  const page = await signUp(browser, 'Daniel', 'owner');
  await expect(page.getByText('Noch keine Rezepte')).toBeVisible();

  // new recipe from text
  await page.getByRole('link', { name: '＋ Neues Rezept' }).click();
  await page.getByRole('textbox', { name: 'Rezepttext' }).fill(SAMPLE);
  await page.getByRole('button', { name: 'Rezept anlegen' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Pfannkuchen (Beispiel)' })).toBeVisible();
  await noOverflow(page);

  // ingredients next to their step, grams by default, other units on tap
  const step1 = page.locator('#s-1');
  await expect(step1.locator('.ings')).toContainText('125 g');
  await expect(step1.locator('.ings')).toContainText('Weizenmehl Type 405');
  await step1.getByRole('button', { name: /125 g, antippen für ml/ }).click();
  await expect(step1.locator('.ings')).toContainText('≈ 225 ml');
  await expect(page.locator('#s-2 .ings')).toContainText('2 Eier (Größe M)');

  // the "i" explains why
  await step1.getByRole('button', { name: 'einrühren – Erklärung zeigen' }).click();
  await expect(step1.locator('.tipbox')).toContainText('Erst wenig Milch');

  // scaling
  await page.getByRole('button', { name: 'mehr' }).click();
  await expect(page.locator('.stepper output')).toHaveText('5 Stück');
  await expect(page.locator('#s-1 .ings')).toContainText('313 g');
  await page.getByRole('button', { name: 'weniger' }).click();

  // two timers at once; the first one rings with the step's text until "Erledigt"
  await page.locator('#s-2').getByRole('button', { name: /20 min/ }).click();
  await page.locator('#s-3').getByRole('button', { name: /2 min/ }).click();
  await expect(page.locator('#timerbar .tchip')).toHaveCount(2);
  await expect(page.locator('#timerbar')).toContainText('Pfannkuchen wenden');
  await page.clock.fastForward('02:05');
  await expect(page.locator('.alarm')).toBeVisible();
  await expect(page.locator('.alarm h2')).toHaveText('Pfannkuchen wenden');
  await page.locator('.alarm').getByRole('button', { name: 'Erledigt' }).click();
  await expect(page.locator('.alarm')).toHaveCount(0);
  await expect(page.locator('#timerbar .tchip')).toHaveCount(1);
  await page.clock.fastForward('18:00');
  await expect(page.locator('.alarm h2')).toHaveText('Teig ist fertig: Pfanne heiß werden lassen');
  await page.locator('.alarm').getByRole('button', { name: '+1 min' }).click();
  await expect(page.locator('.alarm')).toHaveCount(0);
  await page.locator('#timerbar').getByRole('button', { name: 'Timer beenden' }).click();
  await expect(page.locator('#timerbar .tchip')).toHaveCount(0);

  // summed-up list
  await page.getByRole('tab', { name: 'Zutaten' }).click();
  await expect(page.locator('.shop').first()).toContainText('Weizenmehl Type 405');
  await expect(page.locator('.shop').first()).toContainText('Schritt 1');

  // nutrition facts: a short note at the top, the table under the list, where the values come from
  await expect(page.locator('.facts button.kcal')).toHaveText('≈ 200 kcal pro Stück');
  await expect(page.locator('#naehrwerte .facts-table tbody tr').first()).toContainText('200 kcal');
  await page.getByText('Woher die Werte kommen').click();
  await expect(page.locator('.src', { hasText: 'Butter' })).toContainText('Süßrahmbutter');
  // an editor counts an ingredient as a different food, for the whole cookbook
  await page.locator('.src', { hasText: 'Butter' }).getByRole('button', { name: 'ändern' }).click();
  await page.locator('.picker input').fill('Butter gesalzen');
  await page.locator('.pick-list button').first().click();
  await expect(page.locator('.src', { hasText: 'Butter' })).toContainText('Butter gesalzen');
  await expect(page.locator('.src', { hasText: 'Butter' })).toContainText('von Hand');
  await noOverflow(page);

  // feedback with name, edit, delete
  await page.getByRole('tab', { name: 'Feedback' }).click();
  await page.getByRole('textbox').fill('Teig etwas zu dick – nächstes Mal 20 g mehr Milch.');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.comment')).toContainText('Daniel');
  await expect(page.locator('.comment')).toContainText('20 g mehr Milch');
  await page.locator('.comment').getByRole('button', { name: 'Bearbeiten' }).click();
  await page.locator('.comment textarea').fill('Teig zu dick – 20 g mehr Milch.');
  await page.locator('.comment').getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.comment')).toContainText('bearbeitet');

  // next version from the feedback
  await page.getByRole('link', { name: '✎ Bearbeiten' }).click();
  await expect(page.getByText('Feedback zu Version 1 (1)')).toBeVisible();
  const ta = page.getByRole('textbox', { name: 'Rezepttext' });
  await ta.fill(SAMPLE.replace('- 250 g Milch', '- 270 g Milch'));
  await page.locator('#msg').fill('20 g mehr Milch, Teig war zu dick');
  await page.getByRole('button', { name: 'Als Version 2 speichern' }).click();
  await expect(page.locator('.facts')).toContainText('Version 2');
  await page.getByRole('tab', { name: /Versionen/ }).click();
  await expect(page.locator('.version').first()).toContainText('20 g mehr Milch, Teig war zu dick');
  await expect(page.locator('.version').first()).toContainText('Milch: 250 g → 270 g');
  await page.locator('.version').first().getByRole('button', { name: 'Unterschiede' }).click();
  await expect(page.locator('.diff .add')).toContainText('270 g Milch');
  await page.locator('.version').nth(1).getByRole('link', { name: 'Ansehen' }).click();
  await expect(page.getByText('Du siehst Version 1 von 2')).toBeVisible();
  await expect(page.locator('#s-1 .ings')).toContainText('250 g');

  // PDF
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: '⤓ PDF' }).click();
  const file = await (await download).path();
  expect(readFileSync(file).subarray(0, 8).toString()).toBe('%PDF-1.4');

  // invite someone from the app
  await page.getByRole('link', { name: 'Einstellungen' }).click();
  await page.locator('#inv-name').fill('Ben');
  await page.getByRole('button', { name: 'Einladung erstellen' }).click();
  await expect(page.locator('.linkbox')).toContainText('/login/?invite=');
  await expect(page.locator('.qr svg')).toBeVisible();
  await noOverflow(page);
  expect((page as Page & { errors: string[] }).errors).toEqual([]);
  // everything reached the server
  await expect.poll(() => cli('recipes', '--cookbook', 'Testküche'), { timeout: 15000 }).toMatch(/v2\s+1 Feedback/);
});

test('readers comment but do not edit; the command line sees their feedback', async ({ browser }) => {
  const page = await signUp(browser, 'Lea', 'reader');
  await page.getByRole('link', { name: /Pfannkuchen/ }).click();
  await expect(page.locator('.facts')).toContainText('Version 2');
  await expect(page.getByRole('link', { name: '✎ Bearbeiten' })).toHaveCount(0);
  // readers see the nutrition facts and the food Daniel chose, but cannot change it
  await page.getByRole('tab', { name: 'Zutaten' }).click();
  await page.getByText('Woher die Werte kommen').click();
  await expect(page.locator('.src', { hasText: 'Butter' })).toContainText('Butter gesalzen');
  await expect(page.locator('#naehrwerte').getByRole('button', { name: 'ändern' })).toHaveCount(0);
  expect(cli('nutrition', 'Pfannkuchen (Beispiel)', '--cookbook', 'Testküche')).toMatch(/Butter\s+10 g\s+chosen Q6A4000 Butter gesalzen/);
  await page.getByRole('tab', { name: /Feedback/ }).click();
  await page.getByRole('textbox').fill('Lecker!');
  await page.getByRole('button', { name: 'Speichern' }).click();
  await expect(page.locator('.comment').filter({ hasText: 'Lecker!' })).toContainText('Lea');
  // three minutes with the recipe open count as having made it; the start page shows it
  await page.clock.runFor('03:05');
  await page.getByRole('link', { name: 'Zurück' }).click();
  await expect(page.locator('.item', { hasText: 'Pfannkuchen' })).toContainText('1× gemacht');
  await page.getByRole('link', { name: /Pfannkuchen/ }).click();
  await page.getByRole('tab', { name: /Feedback/ }).click();
  // the edited feedback of Daniel cannot be changed by Lea
  await expect(page.locator('.comment').filter({ hasText: 'Daniel' }).getByRole('button', { name: 'Bearbeiten' })).toHaveCount(0);
  await expect.poll(() => cli('context', 'Pfannkuchen (Beispiel)', '--cookbook', 'Testküche'), { timeout: 15000 }).toContain('Lea: Lecker!');
  const ctx = cli('context', 'Pfannkuchen (Beispiel)', '--cookbook', 'Testküche');
  expect(ctx).toContain('zu Version 2');
  expect(ctx).toContain('Daniel (bearbeitet): Teig zu dick – 20 g mehr Milch.');
});
