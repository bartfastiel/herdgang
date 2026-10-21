// Keeps the screen on while cooking (recipe open with „Bildschirm an“) or while a timer runs.
// The browser releases the lock when the page is hidden; it is taken again when the page becomes visible.

interface Sentinel {
  release(): Promise<void>;
  addEventListener(type: 'release', fn: () => void): void;
}

const reasons = new Set<string>();
let sentinel: Sentinel | null = null;
let pending = false;

export const screenLockSupported = () => 'wakeLock' in navigator;

async function sync(): Promise<void> {
  const want = reasons.size > 0 && document.visibilityState === 'visible';
  if (want && !sentinel && !pending && screenLockSupported()) {
    pending = true;
    try {
      const s = (await (navigator as unknown as { wakeLock: { request(t: 'screen'): Promise<Sentinel> } }).wakeLock.request('screen')) as Sentinel;
      sentinel = s;
      s.addEventListener('release', () => {
        if (sentinel === s) sentinel = null;
      });
    } catch {
      // not allowed right now (e.g. battery saver) – nothing to do
    } finally {
      pending = false;
    }
  } else if (!want && sentinel) {
    const s = sentinel;
    sentinel = null;
    await s.release().catch(() => undefined);
  }
}

export function holdScreen(reason: string, on: boolean): void {
  if (on) reasons.add(reason);
  else reasons.delete(reason);
  void sync();
}

document.addEventListener('visibilitychange', () => void sync());
