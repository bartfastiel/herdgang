// Settings: own name, cookbook, timer notifications, screen, inviting people (owners), backup, sign-out.
import { invitePdf } from '../pdf/invite-pdf.ts';
import { qrSvg } from '../qr.ts';
import { entries } from '../state.ts';
import { account, currentCookbook, currentMode, isOwner, logout, post, rename, switchCookbook, syncInfo, syncNow } from '../sync.ts';
import { enablePush, pushState } from '../timers.ts';
import { add, clear, confirmButton, fmtDateTime, h, segmented, toast } from '../ui/dom.ts';
import { screenLockSupported } from '../ui/wakelock.ts';
import { screenWanted } from './recipe.ts';

const ROLE_LABEL: Record<string, string> = { owner: 'besitzt das Kochbuch', editor: 'bearbeitet Rezepte', reader: 'liest und kommentiert' };

function download(bytes: Uint8Array | string, name: string, type: string): void {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = h('a', { href: url, download: name });
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 60000);
}

export function settingsView(root: HTMLElement): void {
  const me = account();
  const cb = currentCookbook();
  const mode = currentMode();
  root.appendChild(h('h1', null, 'Einstellungen'));

  if (mode === 'server' && me) {
    const name = h('input', { type: 'text', id: 'name', value: me.user.name, maxlength: '40', autocomplete: 'nickname' }) as HTMLInputElement;
    root.appendChild(
      h('section', { class: 'card' },
        h('label', { for: 'name' }, 'Dein Name'),
        h('p', { class: 'muted small' }, 'Steht bei deinem Feedback und deinen Versionen.'),
        h('div', { class: 'row' }, h('div', { class: 'grow' }, name), h('button', { type: 'button', onclick: () => void rename(name.value.trim()).then((ok) => toast(ok ? 'Gespeichert.' : 'Ging nicht – offline?')) }, 'Speichern'))),
    );
    const books = h('section', { class: 'card' }, h('h2', null, 'Kochbuch'));
    if (cb) books.appendChild(h('p', null, h('b', null, cb.name), h('span', { class: 'muted' }, ' – du ' + ROLE_LABEL[cb.role])));
    if (me.cookbooks.length > 1) {
      books.appendChild(h('p', { class: 'muted small' }, 'Du hast Zugang zu mehreren Kochbüchern:'));
      books.appendChild(
        segmented('Kochbuch wählen', me.cookbooks.map((c) => ({ value: c.id, label: c.name })), cb ? cb.id : undefined, (v) => v && v !== (cb && cb.id) && switchCookbook(v), false),
      );
    }
    const info = syncInfo();
    books.appendChild(h('p', { class: 'muted small' }, info.lastError ? 'Abgleich: ' + info.lastError : info.lastSync ? 'Zuletzt abgeglichen: ' + fmtDateTime(info.lastSync) : 'Noch nicht abgeglichen.', ' ', h('button', { type: 'button', class: 'link', onclick: () => void syncNow().then(() => toast('Abgeglichen.')) }, 'Jetzt abgleichen')));
    root.appendChild(books);
  } else {
    root.appendChild(
      h('div', { class: 'notice' }, mode === 'preview' ? 'Vorschau: eigene Testdaten auf diesem Gerät, kein Abgleich mit dem Server.' : 'Lokaler Modus ohne Server: Daten bleiben auf diesem Gerät.'),
    );
  }

  // timers
  const push = pushState();
  const timers = h('section', { class: 'card' }, h('h2', null, 'Timer'));
  timers.appendChild(h('p', { class: 'small' }, 'Timer klingeln wie ein Wecker, solange Herdgang offen ist – auch wenn das Handy auf lautlos steht. Der Bildschirm bleibt dafür an.'));
  if (push === 'on') timers.appendChild(h('p', { class: 'small' }, '✓ Benachrichtigungen sind eingerichtet: Ist das Handy gesperrt, kommt zur Zeit eine Benachrichtigung (mit dem Ton des Handys).'));
  else if (push === 'off') add(timers, h('p', { class: 'small' }, 'Damit sich ein Timer auch bei gesperrtem Handy meldet:'), h('button', { type: 'button', class: 'primary', onclick: () => void enablePush().then(() => location.reload()) }, 'Benachrichtigungen einrichten'));
  else if (push === 'denied') timers.appendChild(h('p', { class: 'small' }, 'Benachrichtigungen sind für Herdgang blockiert. Freigeben lässt sich das in den Website-Einstellungen des Browsers.'));
  else if (mode === 'server') timers.appendChild(h('p', { class: 'small muted' }, 'Benachrichtigungen gehen hier nicht. Auf dem iPhone/iPad: erst „Zum Home-Bildschirm“ hinzufügen und Herdgang von dort öffnen.'));
  if (screenLockSupported()) {
    timers.appendChild(
      segmented('Bildschirm beim Kochen', [{ value: 'on', label: '☀ Bildschirm bleibt an' }, { value: 'off', label: 'darf ausgehen' }], screenWanted() ? 'on' : 'off', (v) => {
        try {
          localStorage.setItem('herdgang.screen', v === 'off' ? '0' : '1');
        } catch {}
      }, false),
    );
  }
  root.appendChild(timers);

  if (isOwner() && cb) root.appendChild(inviteCard(cb.id, cb.name));
  if (mode === 'server' && cb) root.appendChild(membersCard(cb.id));

  // backup
  root.appendChild(
    h('section', { class: 'card' },
      h('h2', null, 'Daten'),
      h('p', { class: 'small' }, `${entries().length} Rezepte. Alle Daten liegen auf diesem Gerät und – angemeldet – auf dem eigenen Server.`),
      h('div', { class: 'row' },
        h('button', {
          type: 'button',
          onclick: () => {
            const text = entries().map((e) => e.head.source.trimEnd()).join('\n\n\f\n\n');
            download(text + '\n', 'herdgang-rezepte.txt', 'text/plain;charset=utf-8');
          },
        }, 'Alle Rezepte als Text'),
        h('button', {
          type: 'button',
          onclick: () => {
            const data = entries().map((e) => ({ recipe: e.recipe, revisions: e.revisions, comments: e.comments }));
            download(JSON.stringify({ exported: Date.now(), cookbook: cb ? cb.name : null, recipes: data }, null, 1), 'herdgang-sicherung.json', 'application/json');
          },
        }, 'Sicherung (JSON)'))),
  );

  root.appendChild(
    h('section', { class: 'card' },
      h('h2', null, 'Über'),
      h('p', { class: 'small' }, 'Herdgang – Rezepte, die beim Kochen helfen. ', h('a', { href: '#/help' }, 'So funktioniert’s')),
      h('p', { class: 'small muted' }, 'Version ' + (document.documentElement.dataset.version || '?')),
      mode === 'server' ? h('button', { type: 'button', onclick: () => void logout() }, 'Abmelden') : null),
  );
}

function inviteCard(cookbookId: string, cookbookName: string): HTMLElement {
  const card = h('section', { class: 'card' }, h('h2', null, 'Jemanden einladen'));
  const name = h('input', { type: 'text', id: 'inv-name', placeholder: 'Vorname', maxlength: '40' }) as HTMLInputElement;
  let role = 'reader';
  const out = h('div');
  add(card,
    h('p', { class: 'small' }, 'Einladungen gelten 14 Tage und nur einmal. Pro Gerät eine Einladung – wer schon Zugang hat, kann auf weiteren Geräten denselben Passkey nutzen, wenn er synchronisiert ist (z. B. Google- oder Apple-Konto).'),
    h('label', { for: 'inv-name' }, 'Name'),
    name,
    h('label', null, 'Darf'),
    segmented('Rolle', [{ value: 'reader', label: 'lesen & kommentieren' }, { value: 'editor', label: 'Rezepte bearbeiten' }, { value: 'owner', label: 'alles' }], role, (v) => (role = v || 'reader'), false),
    h('p', null),
    h('button', {
      type: 'button',
      class: 'primary',
      onclick: async () => {
        const n = name.value.trim();
        if (!n) return void name.focus();
        const res = await post('/api/invites', { cookbook: cookbookId, name: n, role });
        const data = (await res.json().catch(() => ({}))) as { link?: string; expires?: number; error?: { message: string } };
        if (!res.ok || !data.link) return void toast((data.error && data.error.message) || 'Ging nicht – offline?');
        showInvite(out, { name: n, cookbook: cookbookName, link: data.link, expires: data.expires as number });
      },
    }, 'Einladung erstellen'),
    out,
  );
  return card;
}

function showInvite(out: HTMLElement, inv: { name: string; cookbook: string; link: string; expires: number }): void {
  clear(out);
  const qr = h('div', { class: 'qr', role: 'img', 'aria-label': 'QR-Code der Einladung' });
  qr.innerHTML = qrSvg(inv.link);
  add(out,
    h('h3', null, 'Einladung für ' + inv.name),
    qr,
    h('p', { class: 'linkbox' }, inv.link),
    h('div', { class: 'row' },
      h('button', { type: 'button', onclick: () => navigator.clipboard.writeText(inv.link).then(() => toast('Link kopiert.'), () => toast('Kopieren ging nicht.')) }, 'Link kopieren'),
      'share' in navigator ? h('button', { type: 'button', onclick: () => void navigator.share({ title: 'Einladung zu Herdgang', text: `Einladung für ${inv.name} zu „${inv.cookbook}“`, url: inv.link }).catch(() => undefined) }, 'Teilen') : null,
      h('button', { type: 'button', onclick: () => download(invitePdf(inv), `Einladung-${inv.name}.pdf`, 'application/pdf') }, 'Als PDF')),
    h('p', { class: 'muted small' }, 'Gültig bis ' + fmtDateTime(inv.expires) + '.'),
  );
}

function membersCard(cookbookId: string): HTMLElement {
  const card = h('section', { class: 'card' }, h('h2', null, 'Wer hat Zugang'));
  const list = h('ul', { class: 'members' });
  card.appendChild(list);
  const me = account();
  void fetch('/api/members?cookbook=' + encodeURIComponent(cookbookId), { credentials: 'same-origin' })
    .then((r) => (r.ok ? r.json() : { members: [] }))
    .then((d: { members: { id: string; name: string; role: string; last_seen: number | null }[] }) => {
      for (const m of d.members) {
        list.appendChild(
          h('li', null,
            h('span', { class: 'grow' }, h('b', null, m.name), h('span', { class: 'muted small' }, ' – ' + ROLE_LABEL[m.role] + (m.last_seen ? ' · zuletzt ' + fmtDateTime(m.last_seen) : ''))),
            isOwner() && me && m.id !== me.user.id
              ? confirmButton('Entfernen', 'Wirklich?', async () => {
                  const res = await post('/api/members/remove', { cookbook: cookbookId, user_id: m.id });
                  if (res.ok) (toast(m.name + ' hat keinen Zugang mehr.'), list.querySelectorAll('li').forEach((li) => li.textContent && li.textContent.indexOf(m.name) === 0 && li.remove()));
                })
              : null),
        );
      }
    })
    .catch(() => list.appendChild(h('li', { class: 'muted' }, 'Offline – Liste nicht verfügbar.')));
  return card;
}
