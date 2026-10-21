// Common setup for the recording: show server, browser with a fixed clock (an afternoon of baking), stage, app in an iframe.
import { chromium, type Browser, type Frame, type Page } from '@playwright/test';
import type { Server } from 'node:http';
import { host } from './host.ts';

export interface Stage {
  server: Server;
  browser: Browser;
  page: Page;
  frame: Frame;
}

/** time in the video: a Saturday afternoon */
export const VIDEO_TIME = Date.parse('2026-10-24T15:30:00+02:00');

export async function openStage(port: number, start = '#/'): Promise<Stage> {
  const server = await host(port);
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1920, height: 1080 }, locale: 'de-DE', timezoneId: 'Europe/Berlin', serviceWorkers: 'block', colorScheme: 'light', acceptDownloads: true });
  await context.clock.install({ time: VIDEO_TIME });
  await context.clock.resume();
  const page = await context.newPage();
  page.on('pageerror', (e) => console.log('page error:', e.message));
  await page.goto(`http://localhost:${port}/__stage/`);
  await page.evaluate((h) => (document.getElementById('app') as HTMLIFrameElement).setAttribute('src', '/' + h), start);
  const frame = await (await page.waitForSelector('#app')).contentFrame();
  if (!frame) throw new Error('no iframe');
  await frame.locator('.item').first().waitFor({ timeout: 30000 });
  return { server, browser, page, frame };
}
