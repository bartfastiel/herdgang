// Visual check in phone format against a local backend (STATIC_DIR=dist on :4180, data in .local/data):
// signs in with a fresh invite and a virtual passkey, then takes screenshots.
//   node tools/look.mjs <out dir> [route …]      route: "home", "settings", "help", "new" or "r:<title>[?tab=list]"
//   DEVICE=<Playwright device name>, DARK=1 for the dark theme
import { chromium, devices } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync } from 'node:fs';

const out = process.argv[2];
const routes = process.argv.slice(3);
mkdirSync(out, { recursive: true });
const base = 'http://localhost:4180';
const env = { ...process.env, DATA_DIR: '.local/data', ORIGIN: base };
const cli = (...a) => execFileSync('node', ['dist-server/cli.mjs', ...a], { env }).toString();
const browser = await chromium.launch();
const dev = process.env.DEVICE ? devices[process.env.DEVICE] : { ...devices['Pixel 7'], viewport: { width: 412, height: 892 }, screen: { width: 412, height: 892 }, deviceScaleFactor: 2 };
const W = dev.viewport.width;
const context = await browser.newContext({ ...dev, defaultBrowserType: undefined, locale: 'de-DE', timezoneId: 'Europe/Berlin', colorScheme: process.env.DARK ? 'dark' : 'light' });
const page = await context.newPage();
const errors = [];
page.on('console', (m) => m.type() === 'error' && errors.push(m.text()));
page.on('pageerror', (e) => errors.push(String(e)));
const cdp = await context.newCDPSession(page);
await cdp.send('WebAuthn.enable');
await cdp.send('WebAuthn.addVirtualAuthenticator', { options: { protocol: 'ctap2', transport: 'internal', hasResidentKey: true, hasUserVerification: true, isUserVerified: true } });
const invite = cli('invite', '--name', 'Daniel', '--role', 'owner').trim().split('\n')[0].replace(base, '');
await page.goto(base + invite);
await page.getByRole('button', { name: 'Passkey einrichten' }).click();
await page.waitForURL(base + '/');
await page.waitForTimeout(2500);
const ids = Object.fromEntries(
  cli('recipes')
    .trim()
    .split('\n')
    .filter(Boolean)
    .map((l) => {
      const m = /^(\S+)\s+v\d+\s+\d+ Feedback\s+(.*)$/.exec(l);
      return m ? [m[2], m[1]] : ['', ''];
    }),
);
for (const r of routes) {
  let hash = r === 'home' ? '#/' : '#/' + r;
  if (r.startsWith('r:')) {
    const [title, query] = r.slice(2).split('?');
    hash = '#/r/' + ids[title] + (query ? '?' + query : '');
  }
  await page.goto(base + '/' + hash);
  await page.waitForTimeout(1200);
  const wide = await page.evaluate(() => document.documentElement.scrollWidth);
  if (wide > W + 1) console.log('OVERFLOW', r, wide, '>', W);
  await page.screenshot({ path: `${out}/${r.replace(/[^a-z0-9äöüß]+/gi, '_')}.png`, fullPage: true });
}
console.log('errors:', errors.length ? errors.join('\n') : 'none');
await browser.close();
