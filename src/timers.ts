// Kitchen timers: any number at once, started from a recipe step, kept on this device (localStorage) across reloads.
//
// When a timer is due it rings like an alarm clock until someone taps „Erledigt“: a full-screen notice with the step's
// text („Brot aus dem Ofen nehmen“), a repeating sound and vibration. The sound is played by an <audio> element that was
// unlocked by the tap that started the timer; such media playback is not muted by the silent switch (iOS) or the
// ringer mode (Android). While a timer runs the screen stays on, so the page keeps running.
//
// If the phone is locked or the app is in the background anyway, the server sends a push notification at the due time
// (when notifications are set up on this device). Those follow the phone's sound settings.
import { account, currentMode, post } from './sync.ts';
import { clear, h, toast } from './ui/dom.ts';
import { holdScreen } from './ui/wakelock.ts';

export interface TimerDef {
  /** identifies the timer within a recipe version: `<revision id>:<line>` */
  key: string;
  seconds: number;
  label: string;
  text: string;
  recipeId: string;
  recipeTitle: string;
  step: number;
}

export interface Running extends TimerDef {
  id: string;
  end: number;
  ringing: boolean;
}

const STORE_KEY = 'herdgang.timers';
const PUSH_KEY = 'herdgang.push';
let timers: Running[] = load();
const listeners: (() => void)[] = [];
let ticker = 0;
let audio: HTMLAudioElement | null = null;
let buzz = 0;
let overlay: HTMLElement | null = null;

function load(): Running[] {
  try {
    const v = JSON.parse(localStorage.getItem(STORE_KEY) || '[]') as Running[];
    return Array.isArray(v) ? v : [];
  } catch {
    return [];
  }
}

function save(): void {
  try {
    localStorage.setItem(STORE_KEY, JSON.stringify(timers));
  } catch {}
}

export const running = (): Running[] => timers;
export const byKey = (key: string): Running | undefined => timers.find((t) => t.key === key);

export function onTimers(fn: () => void): () => void {
  listeners.push(fn);
  return () => {
    const i = listeners.indexOf(fn);
    if (i >= 0) listeners.splice(i, 1);
  };
}

function changed(): void {
  save();
  for (const fn of listeners.slice()) fn();
  holdScreen('timers', timers.length > 0);
  if (timers.length && !ticker) ticker = window.setInterval(tick, 250);
  if (!timers.length && ticker) (clearInterval(ticker), (ticker = 0));
  renderOverlay();
}

/** remaining time as m:ss or h:mm:ss (negative after the end) */
export function remaining(t: Running, now = Date.now()): string {
  const s = Math.round((t.end - now) / 1000);
  const a = Math.abs(s);
  const hh = Math.floor(a / 3600);
  const mm = Math.floor((a % 3600) / 60);
  const ss = a % 60;
  const body = (hh ? hh + ':' + String(mm).padStart(2, '0') : String(mm)) + ':' + String(ss).padStart(2, '0');
  return (s < 0 ? '+' : '') + body;
}

function tick(): void {
  const now = Date.now();
  let rang = false;
  for (const t of timers) {
    if (!t.ringing && t.end <= now) {
      t.ringing = true;
      rang = true;
    }
  }
  if (rang) {
    changed();
    startAlarm();
  } else for (const fn of listeners.slice()) fn();
}

// ---- sound -------------------------------------------------------------------------------------------------------

/** a short alarm pattern (three bright beeps, then a pause) as a WAV file, generated once */
function alarmUrl(): string {
  const rate = 22050;
  const seconds = 1.6;
  const n = Math.floor(rate * seconds);
  const buf = new ArrayBuffer(44 + n * 2);
  const v = new DataView(buf);
  const str = (o: number, s: string) => {
    for (let i = 0; i < s.length; i++) v.setUint8(o + i, s.charCodeAt(i));
  };
  str(0, 'RIFF');
  v.setUint32(4, 36 + n * 2, true);
  str(8, 'WAVE');
  str(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, rate, true);
  v.setUint32(28, rate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  str(36, 'data');
  v.setUint32(40, n * 2, true);
  for (let i = 0; i < n; i++) {
    const t = i / rate;
    const k = Math.floor(t / 0.22);
    const on = k < 3 && t - k * 0.22 < 0.16;
    const env = on ? Math.min(1, (t - k * 0.22) * 200, (0.16 - (t - k * 0.22)) * 200) : 0;
    const s = env * (0.62 * Math.sin(2 * Math.PI * 1760 * t) + 0.3 * Math.sin(2 * Math.PI * 2640 * t));
    v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, s)) * 32000, true);
  }
  return URL.createObjectURL(new Blob([buf], { type: 'audio/wav' }));
}

/** called from the tap that starts a timer: prepares the sound so it may play later without a tap */
function unlockAudio(): void {
  try {
    const session = (navigator as unknown as { audioSession?: { type: string } }).audioSession;
    if (session) session.type = 'playback';
  } catch {}
  if (audio) return;
  audio = new Audio(alarmUrl());
  audio.loop = true;
  audio.muted = true;
  audio
    .play()
    .then(() => {
      if (!timers.some((t) => t.ringing)) (audio as HTMLAudioElement).pause();
      (audio as HTMLAudioElement).muted = false;
    })
    .catch(() => {
      if (audio) audio.muted = false;
    });
}

function startAlarm(): void {
  if (audio) {
    audio.muted = false;
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  }
  if (!buzz && navigator.vibrate) {
    navigator.vibrate([400, 150, 400, 150, 400]);
    buzz = window.setInterval(() => navigator.vibrate && navigator.vibrate([400, 150, 400, 150, 400]), 2400);
  }
  void notifyLocally();
}

function stopAlarmIfQuiet(): void {
  if (timers.some((t) => t.ringing)) return;
  if (audio) audio.pause();
  if (buzz) (clearInterval(buzz), (buzz = 0));
  if (navigator.vibrate) navigator.vibrate(0);
}

/** while the page runs but is hidden (other app in front), show a system notification right away */
async function notifyLocally(): Promise<void> {
  if (document.visibilityState === 'visible' || typeof Notification === 'undefined' || Notification.permission !== 'granted') return;
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (!reg) return;
  for (const t of timers.filter((x) => x.ringing)) {
    void reg.showNotification(t.text, { body: `${t.recipeTitle} · Schritt ${t.step}`, tag: t.id, requireInteraction: true, icon: 'icon-192.png', data: { url: '#/r/' + t.recipeId } } as NotificationOptions);
  }
}

async function closeNotification(id: string): Promise<void> {
  const reg = await navigator.serviceWorker?.getRegistration().catch(() => undefined);
  if (!reg) return;
  for (const n of await reg.getNotifications({ tag: id })) n.close();
}

// ---- actions -------------------------------------------------------------------------------------------------------

function newRunId(): string {
  const b = crypto.getRandomValues(new Uint8Array(9));
  return Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
}

export function start(def: TimerDef): Running {
  unlockAudio();
  const old = byKey(def.key);
  if (old) cancel(old.id);
  const t: Running = { ...def, id: newRunId(), end: Date.now() + def.seconds * 1000, ringing: false };
  timers.push(t);
  timers.sort((a, b) => a.end - b.end);
  changed();
  void schedulePush(t);
  if (pushState() === 'off') toast('Tipp: Benachrichtigungen einrichten – dann meldet sich der Timer auch bei gesperrtem Handy.', { label: 'Einrichten', run: () => void enablePush() });
  return t;
}

export function cancel(id: string): void {
  timers = timers.filter((t) => t.id !== id);
  changed();
  stopAlarmIfQuiet();
  void closeNotification(id);
  if (currentMode() === 'server') void post('/api/timers/cancel', { id });
}

/** add minutes (also to a ringing timer: snooze) */
export function extend(id: string, minutes: number): void {
  const t = timers.find((x) => x.id === id);
  if (!t) return;
  t.end = Math.max(t.end, Date.now()) + minutes * 60000;
  if (t.ringing) (t.ringing = false), void closeNotification(id);
  timers.sort((a, b) => a.end - b.end);
  changed();
  stopAlarmIfQuiet();
  void schedulePush(t);
}

export const dismiss = cancel;

// ---- push ----------------------------------------------------------------------------------------------------------

export type PushState = 'unsupported' | 'off' | 'denied' | 'on';

export function pushState(): PushState {
  const me = account();
  if (currentMode() !== 'server' || !me || !me.push_key || !('serviceWorker' in navigator) || !('PushManager' in window) || typeof Notification === 'undefined') return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  if (Notification.permission !== 'granted') return 'off';
  try {
    return localStorage.getItem(PUSH_KEY) ? 'on' : 'off';
  } catch {
    return 'off';
  }
}

function keyBytes(b64: string): Uint8Array<ArrayBuffer> {
  const bin = atob(b64.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** asks for permission (must run in a tap) and registers this device for timer notifications */
export async function enablePush(): Promise<boolean> {
  const me = account();
  if (pushState() === 'unsupported' || !me || !me.push_key) {
    toast('Benachrichtigungen gehen hier nicht. Auf dem iPhone/iPad: Herdgang erst zum Home-Bildschirm hinzufügen.');
    return false;
  }
  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    toast('Benachrichtigungen sind nicht erlaubt. Ändern lässt sich das in den Einstellungen des Browsers.');
    return false;
  }
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyBytes(me.push_key) }));
    const res = await post('/api/push/subscribe', { subscription: sub.toJSON() });
    if (!res.ok) throw new Error(String(res.status));
    localStorage.setItem(PUSH_KEY, sub.endpoint);
    for (const t of timers) if (!t.ringing) void schedulePush(t);
    toast('Benachrichtigungen sind eingerichtet.');
    return true;
  } catch (err) {
    toast('Einrichten hat nicht geklappt: ' + String((err as Error).message || err));
    return false;
  }
}

async function schedulePush(t: Running): Promise<void> {
  if (pushState() !== 'on') return;
  const endpoint = localStorage.getItem(PUSH_KEY);
  await post('/api/timers', { id: t.id, due: t.end, endpoint, title: t.text, body: `${t.recipeTitle} · Schritt ${t.step}`, url: '#/r/' + t.recipeId });
}

// ---- alarm screen --------------------------------------------------------------------------------------------------

function renderOverlay(): void {
  const ringing = timers.filter((t) => t.ringing);
  if (!ringing.length) {
    if (overlay) overlay.remove();
    overlay = null;
    return;
  }
  if (!overlay) {
    overlay = h('div', { class: 'alarm', role: 'alertdialog', 'aria-modal': 'true', 'aria-label': 'Timer abgelaufen' });
    document.body.appendChild(overlay);
  }
  clear(overlay);
  overlay.appendChild(h('p', { class: 'alarm-kicker' }, '⏰ Timer abgelaufen'));
  for (const t of ringing) {
    overlay.appendChild(
      h('section', { class: 'alarm-card' },
        h('h2', null, t.text),
        h('p', { class: 'muted' }, `${t.recipeTitle} · Schritt ${t.step} · ${t.label}`),
        h('button', { type: 'button', class: 'primary wide alarm-done', onclick: () => dismiss(t.id) }, 'Erledigt'),
        h('div', { class: 'row' },
          h('button', { type: 'button', onclick: () => extend(t.id, 1) }, '+1 min'),
          h('button', { type: 'button', onclick: () => extend(t.id, 5) }, '+5 min'),
          h('a', { class: 'button', href: '#/r/' + t.recipeId + '?step=' + t.step, onclick: () => extend(t.id, 1) }, 'Zum Schritt')),
      ),
    );
  }
}

// timers that ran out while the app was closed ring as soon as it opens
if (timers.length) setTimeout(() => (changed(), tick()), 0);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && timers.length) tick();
});
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (e: MessageEvent) => {
    if (e.data && e.data.type === 'timer') tick();
  });
}
