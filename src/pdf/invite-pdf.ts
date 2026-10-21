// An invite as a one-page PDF: QR code, the link, and the few steps to get started.
import { qr } from '../qr.ts';
import { Pdf, wrap, width, type Rgb } from './pdf.ts';

const ACCENT: Rgb = [63, 107, 58];
const INK: Rgb = [33, 29, 25];
const MUTED: Rgb = [110, 102, 94];

export interface InviteInfo {
  name: string;
  cookbook: string;
  link: string;
  expires: number;
  /** another device for someone who already has access */
  newDevice?: boolean;
}

export function invitePdf(inv: InviteInfo): Uint8Array {
  const pdf = new Pdf();
  pdf.title = 'Einladung zu Herdgang';
  const M = 56;
  const W = pdf.w - 2 * M;
  let y = 70;
  pdf.rect(0, 0, pdf.w, 10, ACCENT);
  pdf.text(M, y, 'Herdgang', 'B', 14, ACCENT);
  y += 44;
  pdf.text(M, y, 'Einladung für ' + inv.name, 'B', 30, INK);
  y += 28;
  for (const l of wrap(`zum Kochbuch „${inv.cookbook}“ – Rezepte, die beim Kochen helfen: Zutaten direkt neben dem Schritt, Timer, Rückmeldungen und Versionen.`, 'R', 12.5, W)) {
    pdf.text(M, y, l, 'R', 12.5, MUTED);
    y += 17;
  }
  y += 18;

  // QR code, centered
  const m = qr(inv.link);
  const size = 210;
  const cell = size / (m.length + 8);
  const x0 = (pdf.w - size) / 2;
  pdf.rect(x0, y, size, size, [255, 255, 255]);
  m.forEach((row, ry) => row.forEach((dark, rx) => dark && pdf.rect(x0 + (rx + 4) * cell, y + (ry + 4) * cell, cell + 0.15, cell + 0.15, [0, 0, 0])));
  y += size + 10;
  const hint = 'Mit der Handy-Kamera scannen – oder den Link öffnen:';
  pdf.text((pdf.w - width(hint, 'R', 10)) / 2, y + 4, hint, 'R', 10, MUTED);
  y += 18;
  for (const l of wrapLink(inv.link, W)) {
    pdf.text((pdf.w - width(l, 'R', 9.5)) / 2, y, l, 'R', 9.5, INK);
    y += 13;
  }
  y += 22;

  const steps = inv.newDevice
    ? [
        ['Link auf dem neuen Gerät öffnen', 'Am besten in Chrome (Android) bzw. Safari (iPhone/iPad).'],
        ['„Passkey einrichten“ tippen', 'Bestätigen mit Fingerabdruck, Gesicht oder Geräte-PIN. Kein Passwort, kein Benutzername.'],
        ['Zum Home-Bildschirm hinzufügen', 'Android: Menü (drei Punkte) → „App installieren“. iPhone/iPad: Teilen → „Zum Home-Bildschirm“.'],
      ]
    : [
        ['Link öffnen oder QR-Code scannen', 'Am besten in Chrome (Android) bzw. Safari (iPhone/iPad).'],
        ['„Passkey einrichten“ tippen', 'Bestätigen mit Fingerabdruck, Gesicht oder Geräte-PIN. Kein Passwort, kein Benutzername – künftig meldest du dich genauso an.'],
        ['Zum Home-Bildschirm hinzufügen', 'Android: Menü (drei Punkte) → „App installieren“. iPhone/iPad: Teilen → „Zum Home-Bildschirm“. Dann startet Herdgang wie eine App und funktioniert auch offline.'],
        ['Timer-Benachrichtigungen erlauben', 'Unter ⚙ Einstellungen → „Benachrichtigungen einrichten“. Dann meldet sich ein Timer auch, wenn das Handy gesperrt ist.'],
      ];
  steps.forEach(([title, text], i) => {
    pdf.circle(M + 11, y - 4, 11, ACCENT);
    const n = String(i + 1);
    pdf.text(M + 11 - width(n, 'B', 12) / 2, y + 0.5, n, 'B', 12, [255, 255, 255]);
    pdf.text(M + 32, y, title, 'B', 12.5, INK);
    y += 16;
    for (const l of wrap(text, 'R', 10.5, W - 32)) {
      pdf.text(M + 32, y, l, 'R', 10.5, MUTED);
      y += 14;
    }
    y += 12;
  });

  const until = new Date(inv.expires).toLocaleDateString('de-DE', { day: 'numeric', month: 'long', year: 'numeric' });
  const foot = `Gültig bis ${until} und nur einmal verwendbar. Für jedes weitere Gerät gibt es eine eigene Einladung. Bitte nicht weitergeben – wer den Link hat, kann ihn einlösen.`;
  let fy = pdf.h - 70;
  pdf.line(M, fy - 16, M + W, fy - 16, 0.5, [222, 214, 200]);
  for (const l of wrap(foot, 'R', 9, W)) {
    pdf.text(M, fy, l, 'R', 9, MUTED);
    fy += 12;
  }
  return pdf.bytes();
}

/** a long link broken at sensible places (slashes, question mark, equals sign) */
function wrapLink(s: string, max: number): string[] {
  const out: string[] = [];
  let cur = '';
  // split after / ? = & (no lookbehind: older Safari versions cannot parse it)
  for (const part of s.replace(/([/?=&])/g, '$1\u0000').split('\u0000')) {
    if (cur && width(cur + part, 'R', 9.5) > max) (out.push(cur), (cur = ''));
    cur += part;
  }
  if (cur) out.push(cur);
  return out;
}
