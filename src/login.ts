// Sign-in page (/login/): set up a passkey with an invite link, or sign in with a passkey. A small bundle of its own
// without the rest of the app – without a session only this page is reachable.
import { h } from './ui/dom.ts';

const params = new URLSearchParams(location.search);
const invite = params.get('invite');
const next = safeNext(params.get('next'));
const main = document.getElementById('main') as HTMLElement;
const status = h('p', { class: 'muted', role: 'status', 'aria-live': 'polite' });

function safeNext(v: string | null): string {
  return v && v.charAt(0) === '/' && v.charAt(1) !== '/' && v.indexOf('/login') !== 0 ? v : '/';
}

function bytes(s: string): Uint8Array<ArrayBuffer> {
  const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function b64url(buf: ArrayBuffer): string {
  let s = '';
  for (const b of new Uint8Array(buf)) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

interface Answer {
  ok: boolean;
  data: {
    error?: { message?: string };
    challenge_id?: string;
    cookbook?: string;
    name?: string;
    new_device?: boolean;
    public_key?: Record<string, unknown> & { challenge: string; user?: { id: string }; excludeCredentials?: { id: string }[] };
  };
}

async function api(path: string, body: unknown): Promise<Answer> {
  try {
    const res = await fetch(path, { method: 'POST', credentials: 'same-origin', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { ok: res.ok, data: await res.json().catch(() => ({})) };
  } catch {
    return { ok: false, data: { error: { message: 'Keine Verbindung zum Server.' } } };
  }
}

const errorText = (a: Answer, fallback: string) => (a.data.error && a.data.error.message) || fallback;

async function registerPasskey(): Promise<void> {
  status.textContent = 'Einen Moment …';
  const o = await api('/api/auth/register/options', { invite });
  if (!o.ok || !o.data.public_key) return void (status.textContent = errorText(o, 'Die Einladung ist ungültig.'));
  const pk = o.data.public_key;
  try {
    const cred = (await navigator.credentials.create({
      publicKey: {
        ...(pk as unknown as PublicKeyCredentialCreationOptions),
        challenge: bytes(pk.challenge),
        user: { ...(pk.user as unknown as PublicKeyCredentialUserEntity), id: bytes((pk.user as { id: string }).id) },
        excludeCredentials: (pk.excludeCredentials || []).map((c) => ({ type: 'public-key' as const, id: bytes(c.id) })),
      },
    })) as PublicKeyCredential;
    const r = cred.response as AuthenticatorAttestationResponse;
    const v = await api('/api/auth/register/verify', {
      invite,
      challenge_id: o.data.challenge_id,
      label: navigator.userAgent.slice(0, 80),
      credential: { clientDataJSON: b64url(r.clientDataJSON), attestationObject: b64url(r.attestationObject) },
    });
    if (!v.ok) return void (status.textContent = errorText(v, 'Der Passkey konnte nicht eingerichtet werden.'));
    location.replace(next);
  } catch (err) {
    status.textContent = 'Abgebrochen oder nicht möglich: ' + String((err as Error).message || err);
  }
}

async function loginPasskey(): Promise<void> {
  status.textContent = 'Einen Moment …';
  const o = await api('/api/auth/login/options', {});
  if (!o.ok || !o.data.public_key) return void (status.textContent = errorText(o, 'Anmeldung gerade nicht möglich.'));
  const pk = o.data.public_key;
  try {
    const cred = (await navigator.credentials.get({
      publicKey: { ...(pk as unknown as PublicKeyCredentialRequestOptions), challenge: bytes(pk.challenge), allowCredentials: [] },
    })) as PublicKeyCredential;
    const r = cred.response as AuthenticatorAssertionResponse;
    const v = await api('/api/auth/login/verify', {
      challenge_id: o.data.challenge_id,
      credential: { id: b64url(cred.rawId), clientDataJSON: b64url(r.clientDataJSON), authenticatorData: b64url(r.authenticatorData), signature: b64url(r.signature) },
    });
    if (!v.ok) return void (status.textContent = errorText(v, 'Die Anmeldung hat nicht geklappt.'));
    location.replace(next);
  } catch (err) {
    status.textContent = 'Abgebrochen oder nicht möglich: ' + String((err as Error).message || err);
  }
}

async function acceptWithAccount(): Promise<void> {
  const a = await api('/api/invites/accept', { invite });
  if (!a.ok) return void (status.textContent = errorText(a, 'Die Einladung ist ungültig.'));
  try {
    localStorage.setItem('herdgang.cookbook', String((a.data as { cookbook_id?: string }).cookbook_id || ''));
  } catch {}
  location.replace('/');
}

const card = h('section', { class: 'card' });
main.appendChild(card);

if (invite) {
  const title = h('h2', null, 'Einladung');
  const text = h('p', null, 'Einen Moment …');
  const btn = h('button', { type: 'button', class: 'primary wide', onclick: () => void registerPasskey() }, 'Passkey einrichten');
  card.append(title, text, btn, status);
  void api('/api/invites/info', { invite }).then(async (i) => {
    if (!i.ok) {
      text.textContent = errorText(i, 'Die Einladung ist ungültig oder abgelaufen.');
      btn.remove();
      return;
    }
    title.textContent = 'Hallo ' + (i.data.name || '') + '!';
    text.textContent = i.data.new_device
      ? `Du richtest Herdgang auf einem weiteren Gerät ein (Kochbuch „${i.data.cookbook}“). Anmelden künftig per Fingerabdruck, Gesicht oder Geräte-PIN – ohne Passwort.`
      : `Du bist zum Kochbuch „${i.data.cookbook}“ eingeladen. Dafür richtest du einen Passkey ein: Anmelden künftig per Fingerabdruck, Gesicht oder Geräte-PIN – ohne Benutzername und ohne Passwort.`;
    const me = await fetch('/api/me', { credentials: 'same-origin' }).catch(() => null);
    if (me && me.ok && !i.data.new_device) {
      const who = ((await me.json()) as { user: { name: string } }).user.name;
      card.insertBefore(
        h('p', null, h('button', { type: 'button', class: 'wide', onclick: () => void acceptWithAccount() }, `Als ${who} annehmen (schon angemeldet)`)),
        status,
      );
    }
  });
} else {
  card.append(
    h('h2', null, 'Anmelden'),
    h('p', null, 'Herdgang ist privat. Anmelden nur mit Passkey – Fingerabdruck, Gesicht oder Geräte-PIN. Zugang gibt es per Einladung.'),
    h('button', { type: 'button', class: 'primary wide', onclick: () => void loginPasskey() }, 'Mit Passkey anmelden'),
    status,
  );
}

if (!window.PublicKeyCredential) status.textContent = 'Dieser Browser unterstützt keine Passkeys. Bitte ein aktuelles Chrome, Safari oder Firefox verwenden.';
else if (!invite) {
  fetch('/api/me', { credentials: 'same-origin' })
    .then((r) => {
      if (r.ok) location.replace(next);
    })
    .catch(() => undefined);
}
