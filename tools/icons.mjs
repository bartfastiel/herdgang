// Renders public/icon.svg once into PNGs (home screen icons) with Playwright's Chromium.
import { chromium } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const svg = readFileSync(new URL('../public/icon.svg', import.meta.url), 'utf8');
const browser = await chromium.launch();
for (const size of [180, 192, 512]) {
  const page = await browser.newPage({ viewport: { width: size, height: size } });
  // full-bleed background: home screens apply their own mask
  await page.setContent(`<style>html,body{margin:0;background:#3f6b3a}svg{width:${size}px;height:${size}px;display:block}</style>${svg.replace('rx="112"', 'rx="0"')}`);
  await page.screenshot({ path: fileURLToPath(new URL(`../public/icon-${size}.png`, import.meta.url)) });
  await page.close();
}
await browser.close();
console.log('icons written');
