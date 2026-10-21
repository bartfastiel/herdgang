// Records the explainer video: speech first (edge-tts), then the real app on the stage (phone frame) with Daniel's
// recipes in real time, captured with Chrome's screencast and put together with ffmpeg as an MP4 with sound.
//   npm run build && node tools/video/record.ts [--probe] [--until <scene>] [--cut]
// --probe: sentence lengths only estimated (no speech, no video), to check the flow; each scene leaves a screenshot in
// the work folder. Result: test-results/video/herdgang-erklaervideo.mp4 (+ .srt, poster .jpg). Never into the repo.
import type { Frame, Locator, Page } from '@playwright/test';
import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { recipePdf } from '../../src/pdf/recipe-pdf.ts';
import { parse } from '../../src/recipe/format.ts';
import { SCENES, type Step } from './script.ts';
import { openStage } from './setup.ts';
import { synthesize, type Clip } from './tts.ts';

const args = process.argv.slice(2);
const PROBE = args.includes('--probe');
const UNTIL = args.includes('--until') ? Number(args[args.indexOf('--until') + 1]) : SCENES.length;
const OUT = resolve('test-results/video');
const WORK = join(OUT, 'work');
const FRAMES = join(WORK, 'frames');
const PORT = 4192;
const FPS = 30;
const GAP = 0.45;
const SCENE_GAP = 0.9;

// position of the app screen on the stage (stage.css: --phone-x/-y + 14 px frame, --scale)
const SCREEN = { x: 1290 + 14, y: 58 + 14, scale: 1.1, width: 400, height: 846 };

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class Actor {
  readonly page: Page;
  readonly frame: Frame;
  readonly sounds: { name: string; t: number }[] = [];
  now: () => number = () => 0;
  constructor(page: Page, frame: Frame) {
    this.page = page;
    this.frame = frame;
  }
  text(t: string, exact = true): Locator {
    return this.frame.getByText(t, { exact }).first();
  }
  button(name: string | RegExp, exact = true): Locator {
    return this.frame.getByRole('button', { name, exact }).first();
  }
  link(name: string | RegExp, exact = true): Locator {
    return this.frame.getByRole('link', { name, exact }).first();
  }
  tab(name: string | RegExp): Locator {
    return this.frame.getByRole('tab', { name }).first();
  }
  private async rect(loc: Locator) {
    const r = await loc.evaluate((e) => {
      const b = e.getBoundingClientRect();
      return { x: b.x, y: b.y, width: b.width, height: b.height };
    });
    const top = Math.max(r.y, 0);
    const bottom = Math.min(r.y + r.height, SCREEN.height);
    return { x: SCREEN.x + r.x * SCREEN.scale, y: SCREEN.y + top * SCREEN.scale, width: r.width * SCREEN.scale, height: Math.max(0, bottom - top) * SCREEN.scale };
  }
  /** show a finger tap and click; if the target is out of view, scroll there gently first */
  async tap(loc: Locator): Promise<void> {
    await loc.waitFor({ state: 'visible', timeout: 15000 });
    const inView = await loc.evaluate((e) => {
      const b = e.getBoundingClientRect();
      return b.top >= 110 && b.bottom <= innerHeight - 80;
    });
    if (!inView) await this.scrollTo(loc, 220);
    const r = await this.rect(loc);
    await this.page.evaluate(([x, y]) => (window as any).stage.tap(x, y), [r.x + r.width / 2, r.y + r.height / 2]);
    await sleep(280);
    await loc.evaluate((e) => (e as HTMLElement).click());
    await sleep(500);
  }
  /** type text slowly */
  async type(loc: Locator, text: string, delay = 70): Promise<void> {
    await this.tap(loc);
    await loc.pressSequentially(text, { delay });
  }
  async ring(loc: Locator | null): Promise<void> {
    const r = loc ? await this.rect(loc) : null;
    await this.page.evaluate((rect) => (window as any).stage.ring(rect), r);
  }
  /** scroll an element gently to the given distance from the top (below the sticky header and tabs) */
  async scrollTo(loc: Locator, offset = 120): Promise<void> {
    await loc.waitFor({ state: 'attached', timeout: 15000 });
    await loc.evaluate((e, off) => {
      const top = e.getBoundingClientRect().top + scrollY - off;
      scrollTo({ top: Math.max(0, top), behavior: 'smooth' });
    }, offset);
    await sleep(1100);
  }
  async scrollBy(px: number): Promise<void> {
    await this.frame.evaluate((d) => scrollBy({ top: d, behavior: 'smooth' }), px);
    await sleep(1000);
  }
  async goto(hash: string): Promise<void> {
    await this.frame.evaluate((h) => {
      location.hash = h;
    }, hash);
    await sleep(800);
  }
  /** jump the clock of the app forward (timers) */
  async fastForward(ms: number): Promise<void> {
    await this.page.clock.fastForward(ms);
    await sleep(400);
  }
  /** a sound effect at this moment of the video */
  sound(name: string): void {
    this.sounds.push({ name, t: this.now() });
  }
  async paper(src: string | null): Promise<void> {
    await this.page.evaluate((s) => (window as any).stage.paper(s), src);
  }
  wait(seconds: number): Promise<void> {
    return sleep(seconds * 1000);
  }
}

function estimate(texts: string[]): Clip[] {
  return texts.map((text) => ({ text, file: '', duration: 0.5 + text.length * 0.062 }));
}

function srtTime(s: number): string {
  const ms = Math.round(s * 1000);
  const p = (n: number, w = 2) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000))}:${p(Math.floor(ms / 60000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`;
}

/** the app's alarm sound (three beeps, src/timers.ts), twice, as a WAV file */
function alarmWav(file: string): void {
  const rate = 22050;
  const n = Math.floor(rate * 3.2);
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const t = (i / rate) % 1.6;
    const k = Math.floor(t / 0.22);
    const on = k < 3 && t - k * 0.22 < 0.16;
    const env = on ? Math.min(1, (t - k * 0.22) * 200, (0.16 - (t - k * 0.22)) * 200) : 0;
    const s = env * 0.35 * (0.62 * Math.sin(2 * Math.PI * 1760 * (i / rate)) + 0.3 * Math.sin(2 * Math.PI * 2640 * (i / rate)));
    buf.writeInt16LE(Math.round(s * 32000), 44 + i * 2);
  }
  writeFileSync(file, buf);
}

/** the PDF page shown in the video, rendered once from the local cookbook (Python with PyMuPDF) */
function preparePdf(title: string, name: string): void {
  mkdirSync('.local/video', { recursive: true });
  const db = new DatabaseSync('.local/data/herdgang.db', { readOnly: true });
  const revs = (db.prepare("SELECT json FROM records WHERE store = 'revisions' AND deleted = 0").all() as { json: string }[]).map((r) => JSON.parse(r.json) as { source: string; created: number });
  db.close();
  const rev = revs.find((r) => parse(r.source).recipe.title === title);
  if (!rev) throw new Error('recipe not found: ' + title);
  const r = parse(rev.source).recipe;
  const pdf = join('.local/video', name + '.pdf');
  writeFileSync(pdf, recipePdf(r, { factor: 1, version: 1, date: rev.created, yieldText: r.yieldText }));
  execFileSync('python', ['-X', 'utf8', '-I', '-c', 'import sys,pymupdf; d=pymupdf.open(sys.argv[1]); d[0].get_pixmap(dpi=110).save(sys.argv[2])', pdf, join('.local/video', name + '-pdf.png')]);
}

async function main(): Promise<void> {
  preparePdf('Schweinerücken mit Schwarte', 'schweinerucken');
  const scenes = SCENES.slice(0, UNTIL);
  const steps: Step[] = scenes.flatMap((s) => s.steps);
  console.log(`${scenes.length} scenes, ${steps.length} sentences`);
  const clips = PROBE ? estimate(steps.map((s) => s.say)) : synthesize(steps.map((s) => s.say), join(OUT, 'tts'));
  console.log(`speech ${(clips.reduce((a, c) => a + c.duration, 0) / 60).toFixed(1)} min`);

  rmSync(WORK, { recursive: true, force: true });
  mkdirSync(FRAMES, { recursive: true });
  const { server, browser, page, frame } = await openStage(PORT);
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await sleep(1500);
  const actor = new Actor(page, frame);

  const cdp = await page.context().newCDPSession(page);
  const frames: { file: string; t: number }[] = [];
  let t0 = 0;
  const now = () => (Date.now() - t0) / 1000;
  actor.now = now;
  cdp.on('Page.screencastFrame', (f: { data: string; sessionId: number }) => {
    const file = join(FRAMES, `${String(frames.length).padStart(6, '0')}.jpg`);
    writeFileSync(file, Buffer.from(f.data, 'base64'));
    frames.push({ file, t: now() });
    cdp.send('Page.screencastFrameAck', { sessionId: f.sessionId }).catch(() => {});
  });
  await page.evaluate(() => (window as any).stage.card('title-card', true));
  await sleep(300);
  t0 = Date.now();
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 92, maxWidth: 1920, maxHeight: 1080, everyNthFrame: 1 });
  await sleep(1200);

  const placed: (Clip & { start: number })[] = [];
  let i = 0;
  for (const [n, scene] of scenes.entries()) {
    console.log(`scene ${n + 1}/${scenes.length}: ${scene.heading}`);
    await page.evaluate(([k, h]) => (window as any).stage.chapter(k, h), [scene.kicker, scene.heading]);
    if (scene.enter) await scene.enter(actor);
    await sleep(500);
    for (const step of scene.steps) {
      const clip = clips[i++];
      if (step.card !== undefined) await page.evaluate(([id, on]) => (window as any).stage.card(id, on), [step.card || 'title-card', !!step.card] as [string, boolean]);
      if (step.card === false) await page.evaluate(() => (window as any).stage.card('outro-card', false));
      const start = now();
      placed.push({ ...clip, start });
      await page.evaluate((t) => (window as any).stage.caption(t), step.say);
      if (step.bullet) await page.evaluate(([b, k]) => (window as any).stage.bullet(b, k), [step.bullet, step.warn ? 'warn' : ''] as [string, string]);
      const act = step.act ? sleep((step.at || 0) * 1000).then(() => step.act!(actor)) : Promise.resolve();
      await Promise.all([sleep(clip.duration * 1000), act]);
      const spare = start + clip.duration + GAP - now();
      if (spare > 0) await sleep(spare * 1000);
      if (step.hold) await sleep(step.hold * 1000);
    }
    await page.evaluate(() => (window as any).stage.caption(null));
    await actor.ring(null);
    if (PROBE) await page.screenshot({ path: join(WORK, `scene-${String(n + 1).padStart(2, '0')}.png`) });
    await sleep(SCENE_GAP * 1000);
  }
  await sleep(2500);
  const end = now();
  await cdp.send('Page.stopScreencast');
  await browser.close();
  server.close();
  console.log(`recording ${(end / 60).toFixed(1)} min, ${frames.length} frames (${(frames.length / end).toFixed(1)} per s)`);
  if (errors.length) console.log('page errors:\n  ' + errors.join('\n  '));
  if (PROBE) return;

  const list = frames.map((f, k) => `file '${f.file.replace(/\\/g, '/')}'\nduration ${((frames[k + 1]?.t ?? end) - f.t).toFixed(4)}`);
  list.push(`file '${frames[frames.length - 1].file.replace(/\\/g, '/')}'`);
  writeFileSync(join(WORK, 'frames.txt'), list.join('\n') + '\n');
  writeFileSync(join(WORK, 'timeline.json'), JSON.stringify({ end, placed, sounds: actor.sounds }, null, 1));
  cut();
}

/** picture and sound together; with --cut callable on its own (uses work/frames.txt and work/timeline.json) */
function cut(): void {
  const { end, placed, sounds } = JSON.parse(readFileSync(join(WORK, 'timeline.json'), 'utf8')) as { end: number; placed: (Clip & { start: number })[]; sounds: { name: string; t: number }[] };
  const alarm = join(WORK, 'alarm.wav');
  alarmWav(alarm);
  const audio = [...placed.map((c) => ({ file: c.file, start: c.start })), ...sounds.map((s) => ({ file: alarm, start: s.t }))];
  const mp4 = join(OUT, 'herdgang-erklaervideo.mp4');
  const inputs = audio.flatMap((c) => ['-i', c.file]);
  const delays = audio.map((c, k) => `[${k + 1}:a]aresample=48000,adelay=${Math.round(c.start * 1000)}:all=1[a${k}]`);
  const mix = `${audio.map((_, k) => `[a${k}]`).join('')}amix=inputs=${audio.length}:normalize=0:dropout_transition=0,apad,loudnorm=I=-16:TP=-1.5:LRA=11[aout]`;
  const video = `[0:v]fps=${FPS},format=yuv420p[vout]`;
  writeFileSync(join(WORK, 'filter.txt'), [video, ...delays, mix].join(';\n'));
  console.log('putting the video together …');
  execFileSync(
    'ffmpeg',
    ['-y', '-v', 'error', '-f', 'concat', '-safe', '0', '-i', join(WORK, 'frames.txt'), ...inputs, '-/filter_complex', join(WORK, 'filter.txt'), '-map', '[vout]', '-map', '[aout]', '-t', end.toFixed(3), '-c:v', 'libx264', '-preset', 'slow', '-crf', '20', '-c:a', 'aac', '-b:a', '160k', '-ar', '48000', '-movflags', '+faststart', mp4],
    { stdio: 'inherit' },
  );
  const srt = placed.map((c, k) => `${k + 1}\n${srtTime(c.start)} --> ${srtTime(c.start + c.duration)}\n${c.text}\n`).join('\n');
  writeFileSync(join(OUT, 'herdgang-erklaervideo.srt'), srt);
  execFileSync('ffmpeg', ['-y', '-v', 'error', '-ss', '2.5', '-i', mp4, '-frames:v', '1', '-q:v', '3', join(OUT, 'herdgang-erklaervideo.jpg')]);
  console.log(`done: ${mp4} (${(end / 60).toFixed(1)} min)`);
}

if (args.includes('--cut')) cut();
else await main();
