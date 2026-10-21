// One recipe: steps with their ingredients side by side („Ablauf“), the summed-up list with nutrition facts
// („Zutaten“), feedback per version („Feedback“) and the history („Versionen“). Amounts follow the chosen yield;
// tapping an amount switches its unit (g → ml → EL …); tapping a step number marks it done.
import { loadFoods } from '../foods.ts';
import { link, replaceQuery } from '../nav.ts';
import { recipePdf } from '../pdf/recipe-pdf.ts';
import { changedAmounts, diffLines, shoppingList } from '../recipe/compare.ts';
import { context } from '../recipe/context.ts';
import { allSteps, inline, type Ingredient, type Recipe, type Step } from '../recipe/format.ts';
import { choiceLabel, choices, fmtFraction, show, type Choice } from '../recipe/units.ts';
import { addComment, deleteComment, deleteRecipe, editComment, entry, mine, parsed, versionOf, type Entry } from '../state.ts';
import { canEdit, currentMode } from '../sync.ts';
import { byKey, cancel, extend, onTimers, remaining, running, start, type TimerDef } from '../timers.ts';
import { add, clear, confirmButton, fmtDateTime, h, toast } from '../ui/dom.ts';
import { holdScreen, screenLockSupported } from '../ui/wakelock.ts';
import { kcalButton, nutritionSection, pdfNutrition } from './nutrition.ts';
import type { Comment, Revision } from '../data/types.ts';

type Tab = 'steps' | 'list' | 'feedback' | 'versions';
const TABS: [Tab, string][] = [
  ['steps', 'Ablauf'],
  ['list', 'Zutaten'],
  ['feedback', 'Feedback'],
  ['versions', 'Versionen'],
];

interface Ui {
  target?: number;
  units: Record<string, Choice>;
  done: number[];
  got: string[];
}

function loadUi(key: string): Ui {
  try {
    const v = JSON.parse(sessionStorage.getItem('herdgang.ui.' + key) || 'null') as Ui | null;
    if (v) return { units: v.units || {}, done: v.done || [], got: v.got || [], target: v.target };
  } catch {}
  return { units: {}, done: [], got: [] };
}

function saveUi(key: string, ui: Ui): void {
  try {
    sessionStorage.setItem('herdgang.ui.' + key, JSON.stringify(ui));
  } catch {}
}

/** asks main.ts to draw the current page again (after data changes) */
const rerender = () => window.dispatchEvent(new Event('herdgang:render'));

export const screenWanted = (): boolean => {
  try {
    return localStorage.getItem('herdgang.screen') !== '0';
  } catch {
    return true;
  }
};

/** renders the recipe page; returns a clean-up function for leaving the page */
export function recipeView(root: HTMLElement, id: string, params: URLSearchParams): () => void {
  const e = entry(id);
  if (!e) {
    root.appendChild(h('section', { class: 'card' }, h('h2', null, 'Rezept nicht gefunden'), h('p', null, 'Vielleicht wurde es gelöscht.'), h('a', { class: 'button', href: '#/' }, 'Zur Übersicht')));
    return () => undefined;
  }
  const rev = e.revisions.find((r) => r.id === params.get('v')) || e.head;
  const isHead = rev.id === e.head.id;
  const version = versionOf(e, rev.id);
  const p = parsed(rev);
  const r = p.recipe;
  const ui = loadUi(rev.id);
  let tab: Tab = (TABS.find(([t]) => t === params.get('tab')) || TABS[0])[0];
  const baseYield = r.yield ? r.yield.amount : 0;
  const factor = () => (r.yield && ui.target ? ui.target / baseYield : 1);
  const cleanups: (() => void)[] = [];

  // ---- head ----
  const head = h('div', { class: 'rhead' }, h('h1', null, r.title || 'Ohne Titel'), r.subtitle ? h('p', { class: 'sub' }, r.subtitle) : null);
  root.appendChild(head);
  if (!isHead)
    root.appendChild(
      h('div', { class: 'notice old-version' }, `Du siehst Version ${version} von ${e.revisions.length} (${fmtDateTime(rev.created)}). `, h('a', { href: link('recipe', e.recipe.id) }, 'Zur aktuellen Version')),
    );
  if (p.errors.length) root.appendChild(h('div', { class: 'notice' }, 'Diese Version enthält Formatfehler – einiges wird evtl. unvollständig angezeigt.'));
  const kcal = kcalButton(r, factor, () => {
    openTab('list');
    // after the section has drawn its table (it waits for the same promise)
    void loadFoods().then(() => {
      const el = document.getElementById('naehrwerte');
      if (el) el.scrollIntoView({ block: 'start' });
    });
  });
  root.appendChild(
    h('div', { class: 'facts' },
      r.time ? h('span', null, '⏱ ' + r.time) : null,
      h('span', { class: 'badge' }, 'Version ' + version),
      e.comments.length ? h('span', { class: 'badge warn' }, '💬 ' + e.comments.length) : null,
      kcal.el),
  );

  // ---- toolbar ----
  const yieldOut = h('output', { 'aria-live': 'polite' });
  const showYield = () => {
    if (!r.yield) return;
    const t = ui.target || baseYield;
    yieldOut.textContent = fmtFraction(t, t < 2 ? 0.25 : 0.5) + ' ' + r.yield.unit;
  };
  const stepYield = (dir: number) => {
    if (!r.yield) return;
    const t = ui.target || baseYield;
    const step = baseYield >= 2 ? 1 : 0.5;
    const next = Math.max(step, Math.round((t + dir * step) / step) * step);
    ui.target = next === baseYield ? undefined : next;
    saveUi(rev.id, ui);
    showYield();
    renderBody();
    kcal.update();
  };
  const screenBtn = h('button', { type: 'button', 'aria-pressed': 'false', title: 'Bildschirm beim Kochen anlassen' });
  const setScreen = (on: boolean) => {
    screenBtn.setAttribute('aria-pressed', on ? 'true' : 'false');
    screenBtn.textContent = on ? '☀ Bildschirm bleibt an' : '☾ Bildschirm darf aus';
    holdScreen('recipe', on);
  };
  screenBtn.addEventListener('click', () => {
    const on = screenBtn.getAttribute('aria-pressed') !== 'true';
    try {
      localStorage.setItem('herdgang.screen', on ? '1' : '0');
    } catch {}
    setScreen(on);
  });
  if (screenLockSupported()) setScreen(screenWanted());
  cleanups.push(() => holdScreen('recipe', false));

  root.appendChild(
    h('div', { class: 'toolbar' },
      r.yield
        ? h('div', { class: 'stepper', role: 'group', 'aria-label': 'Menge' },
            h('button', { type: 'button', 'aria-label': 'weniger', onclick: () => stepYield(-1) }, '−'),
            yieldOut,
            h('button', { type: 'button', 'aria-label': 'mehr', onclick: () => stepYield(1) }, '+'))
        : null,
      h('button', { type: 'button', onclick: () => downloadPdf(e, rev, r, factor(), ui, version) }, '⤓ PDF'),
      screenLockSupported() ? screenBtn : null,
      canEdit() && isHead ? h('a', { class: 'button', href: link('edit', e.recipe.id) }, '✎ Bearbeiten') : null),
  );
  showYield();

  // ---- tabs ----
  const tabBar = h('div', { class: 'tabs', role: 'tablist' });
  const body = h('div', { role: 'tabpanel' });
  const openTab = (t: Tab) => {
    tab = t;
    replaceQuery({ tab: t === 'steps' ? undefined : t });
    renderTabs();
    renderBody();
  };
  const renderTabs = () => {
    clear(tabBar);
    for (const [t, label] of TABS) {
      const count = t === 'feedback' ? e.comments.length : t === 'versions' ? e.revisions.length : 0;
      tabBar.appendChild(
        h('button', {
          type: 'button',
          role: 'tab',
          'aria-selected': t === tab ? 'true' : 'false',
          onclick: () => {
            openTab(t);
            window.scrollTo(0, Math.min(window.scrollY, (head.offsetTop || 0) + head.offsetHeight));
          },
        }, label + (count ? ` (${count})` : '')),
      );
    }
  };
  root.appendChild(tabBar);
  root.appendChild(body);
  renderTabs();

  let stopTimers: (() => void) | null = null;
  function renderBody(): void {
    if (stopTimers) (stopTimers(), (stopTimers = null));
    clear(body);
    if (tab === 'steps') stopTimers = stepsTab(body, e as Entry, rev, r, ui, factor());
    else if (tab === 'list') listTab(body, r, rev, ui, factor());
    else if (tab === 'feedback') feedbackTab(body, e as Entry, rev, version, rerender);
    else versionsTab(body, e as Entry, rev);
  }
  const cleanupAll = () => {
    if (stopTimers) (stopTimers(), (stopTimers = null));
    for (const c of cleanups.splice(0)) c();
  };
  renderBody();

  const step = Number(params.get('step'));
  if (step && tab === 'steps') {
    setTimeout(() => {
      const el = document.getElementById('s-' + step);
      if (el) {
        el.scrollIntoView({ block: 'start' });
        el.classList.add('target');
      }
    }, 50);
  }
  return cleanupAll;
}

// ---- Ablauf ----------------------------------------------------------------------------------------------------------

function ingredientRow(ing: Ingredient, ui: Ui, saveKey: string, factor: number, onTip?: () => void): HTMLElement {
  const opts = choices(ing);
  const row = h('div', { class: 'ing' });
  const render = () => {
    clear(row);
    const s = show(ing, factor, ui.units[ing.line]);
    const amount = [s.qty, s.unit].filter(Boolean).join(' ');
    const cur = ui.units[ing.line] && opts.indexOf(ui.units[ing.line]) >= 0 ? ui.units[ing.line] : opts[0];
    if (amount) {
      const next = opts[(opts.indexOf(cur) + 1) % opts.length];
      row.appendChild(
        opts.length > 1
          ? h('button', {
              type: 'button',
              class: 'amt switch' + (s.approx ? ' approx' : ''),
              'aria-label': `${amount}, antippen für ${choiceLabel(next, ing)}`,
              onclick: () => {
                ui.units[ing.line] = next;
                saveUi(saveKey, ui);
                render();
              },
            }, amount)
          : h('span', { class: 'amt' + (s.approx ? ' approx' : '') }, amount),
      );
      row.appendChild(document.createTextNode(' '));
    }
    row.appendChild(
      h('span', { class: 'nm' }, s.name, ing.note ? h('span', { class: 'note' }, ', ' + ing.note) : null, ing.tip && onTip ? h('span', { class: 'tip-only', role: 'button', tabindex: '0', 'aria-label': 'Info zu ' + ing.name, onclick: onTip, onkeydown: (ev: Event) => ((ev as KeyboardEvent).key === 'Enter' || (ev as KeyboardEvent).key === ' ') && (ev.preventDefault(), onTip()) }, h('span', { class: 'tip-i' }, 'i')) : null),
    );
  };
  render();
  return row;
}

function timerDef(e: Entry, rev: Revision, r: Recipe, n: number, t: Step['timers'][number]): TimerDef {
  return { key: rev.id + ':' + t.line, seconds: t.seconds, label: t.label, text: t.text, recipeId: e.recipe.id, recipeTitle: r.title, step: n };
}

function timerRow(def: TimerDef): HTMLElement {
  const wrap = h('div', { class: 'timer-row' });
  const render = () => {
    clear(wrap);
    const run = byKey(def.key);
    if (!run) {
      wrap.appendChild(h('button', { type: 'button', class: 'timer-btn', onclick: () => (start(def), render()) }, h('span', { class: 'dur' }, '⏱ ' + def.label), h('span', null, def.text)));
      return;
    }
    wrap.appendChild(
      h('div', { class: 'row' },
        h('button', { type: 'button', class: 'timer-btn grow ' + (run.ringing ? 'ring' : 'run'), 'data-run': run.id, onclick: () => run.ringing && cancel(run.id) },
          h('span', { class: 'dur' }, (run.ringing ? '⏰ ' : '⏱ ') + remaining(run)),
          h('span', null, run.ringing ? def.text + ' – Erledigt' : def.text)),
        h('button', { type: 'button', 'aria-label': 'eine Minute mehr', onclick: () => extend(run.id, 1) }, '+1'),
        confirmButton('✕', 'Stopp?', () => cancel(run.id))),
    );
  };
  render();
  (wrap as HTMLElement & { refresh?: () => void }).refresh = render;
  return wrap;
}

function stepsTab(root: HTMLElement, e: Entry, rev: Revision, r: Recipe, ui: Ui, factor: number): () => void {
  if (r.note) root.appendChild(h('div', { class: 'notice' }, h('b', null, 'Hinweis: '), r.note));
  if (r.equipment.length)
    root.appendChild(h('details', { class: 'equip card' }, h('summary', null, `Geräte (${r.equipment.length})`), h('ul', null, r.equipment.map((x) => h('li', null, x)))));
  const timerRows: (HTMLElement & { refresh?: () => void })[] = [];
  for (const { step, section, n } of allSteps(r)) {
    if (section.title && section.steps[0] === step) root.appendChild(h('h2', { class: 'sec-title' }, section.title));
    const el = h('section', { class: 'step' + (ui.done.indexOf(n) >= 0 ? ' done' : ''), id: 's-' + n });
    const tips = h('div', { class: 'tips' });
    const openTips = new Map<string, HTMLElement>();
    // explanations open and close on a click or tap only – never on mouse-over (Daniel: the page must not jump around)
    const toggleTip = (key: string, label: string, text: string, anchor?: HTMLElement) => {
      const open = openTips.get(key);
      if (open) {
        open.remove();
        openTips.delete(key);
        if (anchor) anchor.classList.remove('open');
        return;
      }
      const box = h('p', { class: 'tipbox' }, label ? h('b', null, label + ': ') : null, text);
      tips.appendChild(box);
      openTips.set(key, box);
      if (anchor) anchor.classList.add('open');
    };
    const ings = h('div', { class: 'ings' });
    for (const ing of step.ingredients) ings.appendChild(ingredientRow(ing, ui, rev.id, factor, ing.tip ? () => toggleTip('ing' + ing.line, ing.name, ing.tip as string) : undefined));
    const text = h('p', null);
    let k = 0;
    for (const seg of inline(step.text)) {
      if (seg.t === 'text') text.appendChild(document.createTextNode(seg.s));
      else if (seg.t === 'bold') text.appendChild(h('b', null, seg.s));
      else {
        const key = 'tip' + k++;
        // a span, not a button: the marked words must wrap with the sentence
        // the last word and the "i" never break apart
        const words = seg.s.split(' ');
        const last = words.pop() || '';
        const btn = h('span', { class: seg.s ? 'tip-a' : 'tip-only', role: 'button', tabindex: '0', 'aria-label': (seg.s || 'Info') + ' – Erklärung zeigen' },
          words.length ? words.join(' ') + ' ' : null, h('span', { class: 'nw' }, last, h('span', { class: 'tip-i', 'aria-hidden': 'true' }, 'i')));
        btn.addEventListener('click', () => toggleTip(key, seg.s, seg.tip, btn));
        btn.addEventListener('keydown', (ev: KeyboardEvent) => {
          if (ev.key === 'Enter' || ev.key === ' ') (ev.preventDefault(), toggleTip(key, seg.s, seg.tip, btn));
        });
        text.appendChild(btn);
      }
    }
    const num = h('button', {
      type: 'button',
      class: 'num',
      'aria-label': `Schritt ${n} ${ui.done.indexOf(n) >= 0 ? 'erledigt' : 'als erledigt markieren'}`,
      onclick: () => {
        const i = ui.done.indexOf(n);
        if (i >= 0) ui.done.splice(i, 1);
        else ui.done.push(n);
        saveUi(rev.id, ui);
        el.classList.toggle('done', i < 0);
      },
    }, String(n));
    const instr = h('div', { class: 'instr' }, h('div', { class: 'text' }, num, text));
    // info texts, warnings and timers use the full width below the two columns
    const extra = h('div', { class: 'extra' }, tips);
    for (const c of step.callouts) extra.appendChild(h('p', { class: 'callout' }, '⚠ ' + c));
    if (step.timers.length) {
      const box = h('div', { class: 'timers' });
      for (const t of step.timers) {
        const row = timerRow(timerDef(e, rev, r, n, t));
        timerRows.push(row);
        box.appendChild(row);
      }
      extra.appendChild(box);
    }
    add(el, ings, instr, extra);
    root.appendChild(el);
  }
  if (!allSteps(r).length) root.appendChild(h('p', { class: 'muted' }, 'Dieses Rezept hat noch keine Schritte.'));
  // live countdowns: rebuild a row when its timer starts/stops/rings, otherwise only update the numbers
  let sig = '';
  const signature = () => running().map((t) => t.id + (t.ringing ? '!' : '')).join(',');
  sig = signature();
  return onTimers(() => {
    const now = signature();
    if (now !== sig) {
      sig = now;
      for (const row of timerRows) if (row.refresh) row.refresh();
      return;
    }
    for (const t of running()) {
      const el = root.querySelector(`[data-run="${t.id}"] .dur`);
      if (el) el.textContent = (t.ringing ? '⏰ ' : '⏱ ') + remaining(t);
    }
  });
}

// ---- Zutaten ---------------------------------------------------------------------------------------------------------

function listTab(root: HTMLElement, r: Recipe, rev: Revision, ui: Ui, factor: number): void {
  const items = shoppingList(r);
  root.appendChild(h('p', { class: 'muted' }, 'Alles zusammengerechnet, in der Reihenfolge der Verwendung. Abhaken, was bereitsteht.'));
  const box = h('div', { class: 'shop' });
  const toggle = (key: string, row: HTMLElement) => {
    const i = ui.got.indexOf(key);
    if (i >= 0) ui.got.splice(i, 1);
    else ui.got.push(key);
    saveUi(rev.id, ui);
    row.classList.toggle('got', i < 0);
  };
  for (const item of items) {
    const key = 'i:' + item.ingredient.name.toLowerCase();
    const ing = { ...item.ingredient, line: -1 - items.indexOf(item), note: item.notes.join('; ') || undefined };
    const row = ingredientRow(ing, ui, rev.id, factor);
    row.classList.toggle('got', ui.got.indexOf(key) >= 0);
    row.insertBefore(h('button', { type: 'button', class: 'check', 'aria-label': 'abhaken', onclick: () => toggle(key, row) }, '✓'), row.firstChild);
    row.appendChild(h('span', { class: 'uses' }, (item.steps.length > 1 ? 'Schritte ' : 'Schritt ') + item.steps.join(', ')));
    box.appendChild(row);
  }
  root.appendChild(box);
  if (r.equipment.length) {
    root.appendChild(h('h2', { class: 'sec-title' }, 'Geräte'));
    const eq = h('div', { class: 'shop' });
    for (const x of r.equipment) {
      const key = 'g:' + x.toLowerCase();
      const row = h('div', { class: 'ing' + (ui.got.indexOf(key) >= 0 ? ' got' : '') }, h('span', { class: 'nm' }, x));
      row.insertBefore(h('button', { type: 'button', class: 'check', 'aria-label': 'abhaken', onclick: () => toggle(key, row) }, '✓'), row.firstChild);
      eq.appendChild(row);
    }
    root.appendChild(eq);
  }
  if (ui.got.length)
    root.appendChild(
      h('p', null, h('button', { type: 'button', class: 'link', onclick: () => ((ui.got = []), saveUi(rev.id, ui), clear(root), listTab(root, r, rev, ui, factor)) }, 'Alle Haken entfernen')),
    );
  root.appendChild(nutritionSection(r, factor));
}

// ---- Feedback --------------------------------------------------------------------------------------------------------

function commentCard(e: Entry, c: Comment, after: () => void): HTMLElement {
  const v = versionOf(e, c.revisionId);
  const card = h('article', { class: 'comment' });
  const render = (editing: boolean) => {
    clear(card);
    add(card, h('div', { class: 'who' }, h('b', null, c.author.name), h('span', null, fmtDateTime(c.created) + (c.edited ? ' · bearbeitet' : '')), h('span', { class: 'badge' }, 'Version ' + (v || '?'))));
    if (!editing) {
      card.appendChild(h('p', null, c.text));
      if (mine(c))
        card.appendChild(
          h('div', { class: 'row' },
            h('button', { type: 'button', class: 'link', onclick: () => render(true) }, 'Bearbeiten'),
            confirmButton('Löschen', 'Wirklich löschen?', () => void deleteComment(c).then(after))),
        );
      return;
    }
    const ta = h('textarea', { 'aria-label': 'Feedback bearbeiten' }) as HTMLTextAreaElement;
    ta.value = c.text;
    add(card, ta, h('div', { class: 'row' },
      h('button', { type: 'button', class: 'primary', onclick: () => ta.value.trim() && void editComment(c, ta.value.trim()).then(after) }, 'Speichern'),
      h('button', { type: 'button', onclick: () => render(false) }, 'Abbrechen')));
    ta.focus();
  };
  render(false);
  return card;
}

function feedbackTab(root: HTMLElement, e: Entry, rev: Revision, version: number, after: () => void): void {
  const ta = h('textarea', { id: 'fb', placeholder: 'Was ist dir aufgefallen? Zum Beispiel: „Teig war zu fest – nächstes Mal 20 g mehr Wasser.“' }) as HTMLTextAreaElement;
  const save = h('button', {
    type: 'button',
    class: 'primary',
    onclick: () => {
      const text = ta.value.trim();
      if (!text) return void ta.focus();
      void addComment(e, rev.id, text).then(() => {
        toast('Feedback gespeichert.');
        after();
      });
    },
  }, 'Speichern');
  root.appendChild(
    h('section', { class: 'card' },
      h('label', { for: 'fb' }, `Feedback zu Version ${version}`),
      ta,
      h('div', { class: 'row' }, save, h('span', { class: 'muted small' }, currentMode() === 'server' ? 'wird mit deinem Namen gespeichert' : 'nur auf diesem Gerät'))),
  );
  if (!e.comments.length) root.appendChild(h('p', { class: 'muted' }, 'Noch kein Feedback. Nach dem Kochen kurz notieren, was beim nächsten Mal anders sein soll – daraus entsteht die nächste Version.'));
  const byVersion = e.revisions.slice().reverse();
  for (const r of byVersion) {
    const list = e.comments.filter((c) => c.revisionId === r.id).reverse();
    if (!list.length) continue;
    root.appendChild(h('h3', null, `Version ${versionOf(e, r.id)}` + (r.id === e.head.id ? ' (aktuell)' : '')));
    for (const c of list) root.appendChild(commentCard(e, c, after));
  }
  root.appendChild(
    h('p', { class: 'muted small' },
      h('button', {
        type: 'button',
        class: 'link',
        onclick: () => {
          const text = context(e);
          navigator.clipboard.writeText(text).then(
            () => toast('Rezept, Versionen und Feedback kopiert – z. B. für eine KI, die die nächste Version schreibt.'),
            () => toast('Kopieren ging nicht.'),
          );
        },
      }, '📋 Für KI kopieren'),
      'Rezept, Verlauf und alles Feedback als Text.'),
  );
}

// ---- Versionen -------------------------------------------------------------------------------------------------------

function diffView(a: string, b: string): HTMLElement {
  const lines = diffLines(a, b);
  const box = h('div', { class: 'diff', 'aria-label': 'Unterschiede' });
  // only changed lines with one line of context
  const keep = lines.map((l, i) => l.t !== 'same' || (lines[i - 1] && lines[i - 1].t !== 'same') || (lines[i + 1] && lines[i + 1].t !== 'same'));
  let gap = false;
  lines.forEach((l, i) => {
    if (!keep[i]) {
      if (!gap) box.appendChild(h('div', { class: 'gap' }, '⋯'));
      gap = true;
      return;
    }
    gap = false;
    box.appendChild(h('div', { class: l.t }, (l.t === 'add' ? '+ ' : l.t === 'del' ? '− ' : '  ') + l.s));
  });
  return box;
}

function versionsTab(root: HTMLElement, e: Entry, viewing: Revision): void {
  root.appendChild(h('p', { class: 'muted' }, 'Jede Änderung ist eine eigene Version – ältere bleiben erhalten und lassen sich jederzeit ansehen und vergleichen.'));
  e.revisions
    .slice()
    .reverse()
    .forEach((rev) => {
      const v = versionOf(e, rev.id);
      const prev = v > 1 ? e.revisions[v - 2] : null;
      const comments = e.comments.filter((c) => c.revisionId === rev.id).length;
      const changes = prev ? changedAmounts(parsed(prev).recipe, parsed(rev).recipe) : [];
      const card = h('article', { class: 'version' + (rev.id === e.head.id ? ' current' : '') },
        h('div', { class: 'row' },
          h('b', null, `Version ${v}`),
          rev.id === e.head.id ? h('span', { class: 'badge' }, 'aktuell') : null,
          rev.id === viewing.id && rev.id !== e.head.id ? h('span', { class: 'badge warn' }, 'angezeigt') : null,
          comments ? h('span', { class: 'badge warn' }, '💬 ' + comments) : null),
        h('div', { class: 'muted small' }, `${fmtDateTime(rev.created)} · ${rev.author.name}`),
        h('p', { class: 'msg' }, rev.message),
        changes.length ? h('div', { class: 'changes' }, changes.slice(0, 8).map((c) => h('span', { class: 'badge' }, c))) : null);
      const actions = h('div', { class: 'row' });
      if (rev.id !== viewing.id) actions.appendChild(h('a', { class: 'button', href: link('recipe', e.recipe.id, { v: rev.id === e.head.id ? undefined : rev.id }) }, 'Ansehen'));
      if (prev) {
        let open: HTMLElement | null = null;
        const btn = h('button', {
          type: 'button',
          onclick: () => {
            if (open) {
              open.remove();
              open = null;
              btn.textContent = 'Unterschiede';
              return;
            }
            open = diffView(prev.source, rev.source);
            card.appendChild(open);
            btn.textContent = 'Unterschiede ausblenden';
          },
        }, 'Unterschiede');
        actions.appendChild(btn);
      }
      card.appendChild(actions);
      root.appendChild(card);
    });
  if (canEdit())
    root.appendChild(
      h('section', { class: 'card' },
        h('h3', null, 'Rezept löschen'),
        h('p', { class: 'muted small' }, 'Entfernt das Rezept mit allen Versionen und allem Feedback aus dem Kochbuch.'),
        confirmButton('Rezept löschen', 'Wirklich löschen?', () => void deleteRecipe(e).then(() => (location.hash = '#/')))),
    );
}

// ---- PDF -------------------------------------------------------------------------------------------------------------

function downloadPdf(e: Entry, rev: Revision, r: Recipe, factor: number, ui: Ui, version: number): void {
  const choicesByLine: Record<number, Choice> = {};
  for (const k of Object.keys(ui.units)) choicesByLine[Number(k)] = ui.units[k];
  const yieldText = r.yield ? (factor !== 1 ? `${fmtFraction(r.yield.amount * factor, 0.25)} ${r.yield.unit} (umgerechnet)` : r.yieldText) : r.yieldText;
  const bytes = recipePdf(r, { factor, choices: choicesByLine, version, date: rev.created, yieldText, nutrition: pdfNutrition(r, factor) });
  const name = (r.title || 'Rezept').replace(/[^\p{L}\p{N} _-]+/gu, '').trim().replace(/\s+/g, '-') + '.pdf';
  const file = new File([bytes as BlobPart], name, { type: 'application/pdf' });
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
  if (ios && nav.canShare && nav.canShare({ files: [file] })) {
    void navigator.share({ files: [file], title: r.title }).catch(() => undefined);
    return;
  }
  const url = URL.createObjectURL(file);
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
  toast('PDF „' + name + '“ wird heruntergeladen.');
  void e;
}
