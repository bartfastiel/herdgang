// „Gemacht“: a recipe counts as made once its page has been open and visible for three minutes – time in the
// background does not count. state.ts keeps one entry per person and recipe within six hours, so going back and forth
// while cooking counts once. The start page sorts by these counts.
import { markCooked } from './state.ts';

const NEEDED = 3 * 60 * 1000;
const TICK = 5000;

let watched: { id: string; seen: number; last: number; done: boolean } | null = null;
let timer = 0;

function tick(): void {
  if (!watched || watched.done) return;
  const now = Date.now();
  // a sleeping device or a throttled background tab adds at most two ticks
  const delta = Math.min(now - watched.last, 2 * TICK);
  watched.last = now;
  if (document.visibilityState !== 'visible') return;
  watched.seen += delta;
  if (watched.seen >= NEEDED) {
    watched.done = true;
    void markCooked(watched.id);
  }
}

/** called on every page change with the recipe on screen (null on other pages); redraws of the same page keep counting */
export function watchRecipe(id: string | null): void {
  if (watched && watched.id === id) return;
  watched = id ? { id, seen: 0, last: Date.now(), done: false } : null;
  if (watched && !timer) timer = window.setInterval(tick, TICK);
  if (!watched && timer) {
    clearInterval(timer);
    timer = 0;
  }
}
