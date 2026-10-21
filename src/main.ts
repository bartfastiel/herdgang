// Entry: header, page per route, timer bar, sync, service worker.
import { watchRecipe } from './cooked.ts';
import { current, link } from './nav.ts';
import { entry, reload } from './state.ts';
import { currentCookbook, initSync, onStatus, syncInfo } from './sync.ts';
import { cancel, extend, onTimers, remaining, running } from './timers.ts';
import { clear, h } from './ui/dom.ts';
import { editorView } from './views/editor.ts';
import { helpView } from './views/help.ts';
import { homeView } from './views/home.ts';
import { recipeView } from './views/recipe.ts';
import { settingsView } from './views/settings.ts';

const main = document.getElementById('main') as HTMLElement;
const top = document.getElementById('top') as HTMLElement;
const bar = document.getElementById('timerbar') as HTMLElement;
let leave: (() => void) | null = null;
let lastRoute = '';

function header(): void {
  const { route, id } = current();
  clear(top);
  const dot = h('span', { class: 'sync-dot', title: 'Abgleich' });
  const info = syncInfo();
  dot.classList.add(info.lastError ? 'err' : info.lastSync ? 'ok' : 'idle');
  if (route === 'home') {
    const cb = currentCookbook();
    top.appendChild(h('a', { class: 'brand', href: '#/' }, h('img', { src: 'icon.svg', alt: '', width: 30, height: 30 }), 'Herdgang'));
    top.appendChild(h('span', { class: 'book' }, cb ? cb.name : ''));
  } else {
    const back = route === 'edit' && id ? link('recipe', id) : '#/';
    top.appendChild(h('a', { class: 'icon-btn back', href: back, 'aria-label': 'Zurück' }, '‹'));
    const e = route === 'recipe' || route === 'edit' ? entry(id) : undefined;
    const title = e ? e.title : route === 'settings' ? 'Einstellungen' : route === 'help' ? 'Hilfe' : route === 'new' ? 'Neues Rezept' : '';
    top.appendChild(h('span', { class: 'title' }, title));
  }
  top.appendChild(dot);
  top.appendChild(h('a', { class: 'icon-btn', href: '#/settings', 'aria-label': 'Einstellungen' }, '⚙'));
}

function show(): void {
  const place = current();
  const key = place.route + '/' + place.id;
  const sameRecipe = key === lastRoute;
  if (leave) (leave(), (leave = null));
  clear(main);
  header();
  document.body.dataset.route = place.route;
  watchRecipe(place.route === 'recipe' ? place.id : null);
  if (place.route === 'recipe') leave = recipeView(main, place.id, place.params);
  else if (place.route === 'edit' || place.route === 'new') leave = editorView(main, place.route === 'edit' ? place.id : '');
  else if (place.route === 'settings') settingsView(main);
  else if (place.route === 'help') helpView(main);
  else homeView(main);
  if (!sameRecipe && !place.params.get('step')) window.scrollTo(0, 0);
  lastRoute = key;
}

let barSig = '';
function timerBar(): void {
  const list = running();
  const sig = list.map((t) => t.id + (t.ringing ? '!' : '')).join(',');
  if (sig === barSig) {
    // only the numbers change: no rebuild, so taps on the buttons never get lost
    list.forEach((t, i) => {
      const el = bar.children[i] && bar.children[i].querySelector('.t');
      if (el) el.textContent = remaining(t);
    });
    return;
  }
  barSig = sig;
  document.body.classList.toggle('has-timers', list.length > 0);
  clear(bar);
  bar.classList.toggle('hidden', !list.length);
  for (const t of list) {
    bar.appendChild(
      h('div', { class: 'tchip' + (t.ringing ? ' ring' : '') },
        h('a', { href: link('recipe', t.recipeId, { step: t.step }) }, h('span', { class: 't' }, remaining(t)), h('span', { class: 'l' }, t.text)),
        h('button', { type: 'button', 'aria-label': 'eine Minute mehr', onclick: () => extend(t.id, 1) }, '+1'),
        h('button', { type: 'button', 'aria-label': 'Timer beenden', onclick: () => cancel(t.id) }, '✕')),
    );
  }
}

// after a sync: redraw overview pages, never while someone is typing or editing
const refresh = () =>
  void reload().then(() => {
    const { route } = current();
    const a = document.activeElement;
    const typing = a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT');
    if (route !== 'edit' && route !== 'new' && !typing) show();
  });

onTimers(timerBar);
onStatus(header);
window.addEventListener('herdgang:render', () => void reload().then(show));
window.addEventListener('hashchange', show);

initSync(refresh)
  .then(() => reload())
  .then(() => (show(), timerBar()))
  .catch((err) => {
    main.textContent = 'Der lokale Speicher ist nicht verfügbar (privates Fenster?): ' + String(err && err.message ? err.message : err);
  });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  navigator.serviceWorker.register('sw.js').catch(() => undefined);
}
