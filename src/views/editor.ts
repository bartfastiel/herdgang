// Editing a recipe = writing its next version. The source text is edited directly (format: src/recipe/format.ts),
// with live checking, a preview and the feedback of the current version at hand. Saving needs a short message
// („was und warum“), like a commit. A draft survives reloading.
import { link } from '../nav.ts';
import { diffLines } from '../recipe/compare.ts';
import { parse, TEMPLATE } from '../recipe/format.ts';
import { commit, createRecipe, entry, versionOf } from '../state.ts';
import { canEdit } from '../sync.ts';
import { add, clear, fmtDateTime, h, toast } from '../ui/dom.ts';

const CHEAT = `# Titel
Untertitel: ein Satz
Ergibt: 4 Portionen
Zeit: 30 min Arbeit, 1 h gesamt
Schlagworte: Backen, Süß
Geräte: Springform 26 cm, Handrührgerät
Hinweis: vor dem Start wichtig
Herkunft: Familienrezept

## Abschnitt (optional)

- 250 g Weizenmehl Type 405
- 2 Eier (Größe M) = 100 g, zimmerwarm
- 1 Prise Salz {Info zur Zutat}
Mehl [sieben]{warum genau hier}. **Fett** geht auch.
! Warnung
Timer: 45 min – Kuchen aus dem Ofen nehmen`;

function draftKey(id: string): string {
  return 'herdgang.draft.' + (id || 'new');
}

export function editorView(root: HTMLElement, id: string): () => void {
  if (!canEdit()) {
    root.appendChild(h('p', null, 'Du kannst Rezepte lesen und kommentieren, aber nicht bearbeiten.'));
    return () => undefined;
  }
  const e = id ? entry(id) : undefined;
  if (id && !e) {
    root.appendChild(h('p', null, 'Rezept nicht gefunden.'));
    return () => undefined;
  }
  const base = e ? e.head.source : TEMPLATE;
  let draft: string | null = null;
  try {
    draft = localStorage.getItem(draftKey(id));
  } catch {}

  root.appendChild(h('h1', null, e ? `Version ${e.revisions.length + 1} von „${e.title}“` : 'Neues Rezept'));
  if (draft && draft !== base) root.appendChild(h('div', { class: 'notice info' }, 'Ungespeicherter Entwurf wiederhergestellt.'));

  if (e) {
    const feedback = e.comments.filter((c) => c.revisionId === e.head.id);
    if (feedback.length)
      root.appendChild(
        h('details', { class: 'card', open: true },
          h('summary', null, `Rückmeldungen zu Version ${e.revisions.length} (${feedback.length})`),
          feedback.map((c) => h('p', { class: 'small' }, h('b', null, c.author.name + ': '), c.text, h('span', { class: 'muted' }, ' · ' + fmtDateTime(c.created))))),
      );
  }

  const ta = h('textarea', { 'aria-label': 'Rezepttext', spellcheck: 'true', autocapitalize: 'sentences' }) as HTMLTextAreaElement;
  ta.value = draft || base;
  const problems = h('ul', { class: 'problems', 'aria-live': 'polite' });
  const message = h('input', { type: 'text', id: 'msg', placeholder: e ? 'z. B. „20 g mehr Wasser, Teig war zu fest“' : 'Erste Fassung', maxlength: '200' }) as HTMLInputElement;
  const save = h('button', { type: 'button', class: 'primary wide' }, e ? `Als Version ${e.revisions.length + 1} speichern` : 'Rezept anlegen');
  const preview = h('div', { class: 'card hidden' });

  const gotoLine = (line: number) => {
    const lines = ta.value.split('\n');
    const startPos = lines.slice(0, line - 1).reduce((a, l) => a + l.length + 1, 0);
    ta.focus();
    ta.setSelectionRange(startPos, startPos + (lines[line - 1] || '').length);
  };

  const check = () => {
    const p = parse(ta.value);
    clear(problems);
    for (const x of p.errors) problems.appendChild(h('li', { class: 'err' }, h('button', { type: 'button', onclick: () => gotoLine(x.line) }, `Zeile ${x.line}: ${x.message}`)));
    for (const x of p.warnings) problems.appendChild(h('li', { class: 'warn' }, h('button', { type: 'button', onclick: () => gotoLine(x.line) }, `Zeile ${x.line}: ${x.message}`)));
    const unchanged = !!e && ta.value === e.head.source;
    save.disabled = p.errors.length > 0 || unchanged;
    try {
      if (ta.value !== base) localStorage.setItem(draftKey(id), ta.value);
      else localStorage.removeItem(draftKey(id));
    } catch {}
    if (!preview.classList.contains('hidden')) renderPreview();
    return p;
  };

  const renderPreview = () => {
    clear(preview);
    if (!e) {
      preview.appendChild(h('p', { class: 'muted' }, 'Vorschau nach dem Anlegen in der Rezeptansicht.'));
      return;
    }
    const lines = diffLines(e.head.source, ta.value).filter((l) => l.t !== 'same');
    preview.appendChild(h('h3', null, `Änderungen gegenüber Version ${versionOf(e, e.head.id)}`));
    if (!lines.length) preview.appendChild(h('p', { class: 'muted' }, 'Noch keine Änderungen.'));
    const box = h('div', { class: 'diff' });
    for (const l of lines) box.appendChild(h('div', { class: l.t }, (l.t === 'add' ? '+ ' : '− ') + l.s));
    if (lines.length) preview.appendChild(box);
  };

  let timer = 0;
  ta.addEventListener('input', () => {
    clearTimeout(timer);
    timer = window.setTimeout(check, 250);
  });

  save.addEventListener('click', () => {
    const p = check();
    if (p.errors.length) return;
    const msg = message.value.trim() || (e ? '' : 'Erste Fassung');
    if (!msg) {
      toast('Bitte kurz notieren, was du geändert hast und warum.');
      message.focus();
      return;
    }
    save.disabled = true;
    const done = (recipeId: string) => {
      try {
        localStorage.removeItem(draftKey(id));
      } catch {}
      toast(e ? 'Neue Version gespeichert.' : 'Rezept angelegt.');
      location.hash = link('recipe', recipeId);
    };
    if (e) void commit(e, ta.value, msg).then(() => done(e.recipe.id));
    else void createRecipe(ta.value, msg).then(done);
  });

  add(root,
    h('div', { class: 'editor' }, ta),
    problems,
    h('label', { for: 'msg' }, e ? 'Was hast du geändert und warum?' : 'Notiz zur ersten Fassung'),
    message,
    h('div', { class: 'row' },
      h('button', {
        type: 'button',
        onclick: () => {
          preview.classList.toggle('hidden');
          renderPreview();
        },
      }, 'Änderungen zeigen'),
      draft && draft !== base
        ? h('button', {
            type: 'button',
            class: 'link',
            onclick: () => {
              ta.value = base;
              check();
            },
          }, 'Entwurf verwerfen')
        : null),
    preview,
    h('p', null, save),
    h('p', null, h('a', { href: e ? link('recipe', e.recipe.id) : '#/' }, 'Abbrechen')),
    h('details', { class: 'card cheat' },
      h('summary', null, 'So ist ein Rezept aufgebaut'),
      h('p', null, 'Kopf bis zur ersten Leerzeile. Danach Schritte, getrennt durch Leerzeilen. Zutaten („- “) stehen am Anfang des Schritts, der sie verwendet – in der Reihenfolge, in der sie hineinkommen. Mengen in Gramm; Abzählbares (Eier, Päckchen) als Anzahl, bei Eiern mit „= … g“.'),
      h('pre', null, CHEAT),
      h('p', null, '[Wort]{Erklärung} zeigt ein „i“ mit Erklärung. „Timer: 45 min – Text“ wird zum Timer-Knopf; der Text erscheint, wenn er klingelt.')),
  );
  check();
  return () => clearTimeout(timer);
}
