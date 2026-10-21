// Script of the explainer video. Per scene a kicker and heading on the left, per sentence a subtitle, optionally a bullet
// and an action in the app (starts with the sentence, `at` seconds later). Check statements against the interface.
// Data: the recipes of the local cookbook (.local/data); the clock stands on a Saturday afternoon.
import type { Actor } from './record.ts';

export interface Step {
  say: string;
  bullet?: string;
  warn?: boolean;
  act?: (a: Actor) => Promise<void>;
  at?: number;
  /** extra pause after the sentence in seconds */
  hold?: number;
  /** show the title or outro card, false hides both */
  card?: 'title-card' | 'outro-card' | false;
}

export interface Scene {
  kicker: string;
  heading: string;
  enter?: (a: Actor) => Promise<void>;
  steps: Step[];
}

const item = (a: Actor, title: string) => a.frame.locator('.item').filter({ hasText: title }).first();
const step = (a: Actor, n: number) => a.frame.locator('#s-' + n);
const timer = (a: Actor, text: string) => a.frame.locator('.timer-btn').filter({ hasText: text }).first();

async function openRecipe(a: Actor, title: string): Promise<void> {
  await a.goto('#/');
  await a.wait(0.6);
  // a tag chosen earlier may hide the recipe
  const chosen = a.frame.locator('.chip.on');
  if (await chosen.count()) await a.tap(chosen.first());
  await a.tap(item(a, title));
  await a.wait(1);
}

export const SCENES: Scene[] = [
  {
    kicker: 'Erklärvideo',
    heading: 'Rezepte für den Herd',
    steps: [
      { say: 'Herdgang ist unser Kochbuch fürs Handy und fürs iPad.', card: 'title-card', hold: 0.3 },
      { say: 'Es enthält nur wenige Rezepte, aber jedes ist für das Kochen selbst aufgeschrieben: in der Reihenfolge, in der man wirklich arbeitet.', hold: 0.4 },
      { say: 'Alles, was du siehst, sind Rezepte aus unserer Familiensammlung – komplett neu aufgeschrieben.', card: false, bullet: 'Unsere Rezepte, <b>neu aufgeschrieben</b>' },
    ],
  },
  {
    kicker: 'Übersicht',
    heading: 'Das Kochbuch',
    steps: [
      { say: 'Die Startseite zeigt alle Rezepte. Oben sucht man nach Namen oder Zutaten.', bullet: 'Suche nach Rezept oder <b>Zutat</b>', act: async (a) => {
        await a.type(a.frame.locator('input[type=search]'), 'Knödel', 140);
      } },
      { say: 'Darunter filtern Schlagworte, zum Beispiel alles zum Backen.', act: async (a) => {
        await a.frame.locator('input[type=search]').fill('');
        await a.frame.locator('input[type=search]').dispatchEvent('input');
        await a.wait(0.4);
        await a.tap(a.frame.getByRole('button', { name: 'Backen', exact: true }));
      } },
      { say: 'Wir backen Brownies.', act: async (a) => (await a.tap(item(a, 'Brownies')), await a.wait(0.8)), hold: 0.4 },
    ],
  },
  {
    kicker: 'Das Prinzip',
    heading: 'Zutaten neben dem Schritt',
    steps: [
      { say: 'Links stehen die Zutaten, rechts der Schritt, der sie braucht – genau in der Reihenfolge, in der sie in die Schüssel kommen.', bullet: 'Zutaten <b>neben dem Schritt</b>', act: async (a) => {
        await a.scrollTo(step(a, 2), 130);
        await a.ring(step(a, 2));
      } },
      { say: 'Von oben nach unten gelesen ist die linke Spalte zugleich die ganze Zutatenliste.', bullet: 'Linke Spalte = <b>Zutatenliste</b>', act: async (a) => {
        await a.ring(null);
        await a.scrollTo(step(a, 3), 130);
        await a.ring(a.frame.locator('#s-3 .ings'));
      } },
      { say: 'Und alles kommt dann, wenn es dran ist. Kein „in den vorgeheizten Ofen“ am Ende: Vorheizen steht dort, wo man den Ofen einschalten muss.', bullet: 'Streng <b>chronologisch</b>', act: async (a) => {
        await a.ring(null);
        await a.scrollTo(step(a, 1), 160);
        await a.ring(step(a, 1));
      } },
      { say: 'Wer an einem Schritt fertig ist, tippt auf die Nummer. Dann wird er blass, und man sieht sofort, wo man steht.', bullet: 'Nummer antippen: <b>erledigt</b>', act: async (a) => {
        await a.ring(null);
        await a.tap(a.frame.locator('#s-1 .num'));
        await a.tap(a.frame.locator('#s-2 .num'));
      } },
    ],
  },
  {
    kicker: 'Das „i“',
    heading: 'Warum genau hier?',
    steps: [
      { say: 'Unterstrichene Wörter haben ein kleines i. Ein Tipp erklärt, warum das genau in diesem Rezept an dieser Stelle wichtig ist.', bullet: '„i“ erklärt das <b>Warum</b>', act: async (a) => {
        await a.tap(a.frame.locator('#s-3 .tip-a').first());
        await a.wait(0.6);
        await a.ring(a.frame.locator('#s-3 .tipbox').first());
      } },
      { say: 'Zum Beispiel: Kein Mixer bei Brownies – er schlägt Luft ein, dann werden sie trocken statt saftig.', act: async (a) => {
        await a.ring(null);
        await a.scrollTo(step(a, 5), 140);
        await a.tap(a.frame.locator('#s-5 .tip-only').first());
        await a.wait(0.5);
        await a.ring(a.frame.locator('#s-5 .tipbox').first());
      } },
    ],
  },
  {
    kicker: 'Mengen',
    heading: 'Gramm – oder Löffel',
    steps: [
      { say: 'Mengen stehen in Gramm, denn die Waage ist genauer als jeder Löffel.', bullet: 'Standard: <b>Gramm</b>', act: async (a) => {
        await a.ring(null);
        await a.scrollTo(step(a, 4), 140);
        await a.ring(a.frame.locator('#s-4 .ings'));
      } },
      { say: 'Wer lieber misst, tippt auf die Menge: dann erscheinen Milliliter, Esslöffel oder Teelöffel.', bullet: 'Antippen: <b>ml, EL, TL</b>', act: async (a) => {
        await a.tap(a.frame.locator('#s-4 .amt.switch').first());
        await a.wait(0.8);
        await a.tap(a.frame.locator('#s-4 .amt.switch').first());
      } },
      { say: 'Eier und Päckchen bleiben Stück. Gramm gibt es auch hier auf Tipp.', bullet: 'Eier, Päckchen: <b>Stück</b>', act: async (a) => {
        await a.ring(null);
        await a.scrollTo(step(a, 5), 140);
        await a.tap(a.frame.locator('#s-5 .amt.switch').first());
      } },
      { say: 'Und für eine größere Form rechnet Herdgang alles um – hier auf achtzehn Stück.', bullet: 'Plus und Minus: <b>umrechnen</b>', act: async (a) => {
        await a.scrollBy(-4000);
        for (let k = 0; k < 6; k++) {
          await a.tap(a.frame.getByRole('button', { name: 'mehr', exact: true }));
          await a.wait(0.1);
        }
        await a.scrollTo(step(a, 4), 140);
      } },
    ],
  },
  {
    kicker: 'Timer',
    heading: 'Mehrere Timer gleichzeitig',
    enter: (a) => openRecipe(a, 'Schweinerücken mit Schwarte'),
    steps: [
      { say: 'Beim Schweinerücken laufen drei Dinge parallel: Kroketten im Ofen, Fleisch in der Pfanne, Gemüse im Topf.', bullet: 'Drei Dinge <b>parallel</b>', act: async (a) => {
        await a.scrollTo(timer(a, 'Kroketten prüfen'), 260);
      } },
      { say: 'Bei jedem Schritt steht ein eigener Timer. Wenn die Kroketten im Ofen sind: antippen, er läuft.', bullet: 'Timer am <b>Schritt</b>', act: async (a) => {
        await a.tap(timer(a, 'Kroketten prüfen'));
        await a.wait(0.6);
        await a.tap(timer(a, 'Fleischscheiben flach'));
      } },
      { say: 'Unten stehen alle laufenden Timer mit der Restzeit. Plus eins verlängert, das Kreuz beendet.', bullet: 'Leiste mit <b>allen Timern</b>', act: async (a) => {
        await a.scrollTo(timer(a, 'Gemüse probieren'), 260);
        await a.tap(timer(a, 'Gemüse probieren'));
        await a.wait(0.4);
        await a.ring(a.frame.locator('#timerbar'));
      } },
      { say: 'Ist die Zeit um, klingelt es wie ein Wecker – mit dem, was jetzt zu tun ist. Bis jemand auf Erledigt tippt.', bullet: 'Klingelt mit <b>Handlung</b>', warn: true, act: async (a) => {
        await a.ring(null);
        await a.fastForward(3 * 60 * 1000);
        a.sound('alarm');
        await a.wait(1.2);
        await a.ring(a.frame.locator('.alarm-card').first());
      } },
      { say: 'Das klingelt auch, wenn das Handy auf lautlos steht. Damit das klappt, bleibt der Bildschirm beim Kochen an.', bullet: 'Bildschirm <b>bleibt an</b>', act: async (a) => {
        await a.wait(2.5);
        await a.ring(null);
        await a.tap(a.frame.locator('.alarm').getByRole('button', { name: 'Erledigt' }));
      } },
      { say: 'Ist das Handy doch gesperrt, schickt der Server zur richtigen Zeit eine Benachrichtigung.', bullet: 'Gesperrt: <b>Benachrichtigung</b>', act: async (a) => {
        // the demo ends here: stop the remaining timers via the bar
        const stop = a.frame.locator('#timerbar').getByRole('button', { name: 'Timer beenden' });
        while (await stop.count()) await a.tap(stop.first());
      } },
    ],
  },
  {
    kicker: 'Zutaten',
    heading: 'Einkaufen und bereitstellen',
    steps: [
      { say: 'Der Reiter Zutaten rechnet alles zusammen, zum Einkaufen oder zum Bereitstellen vor dem Start.', bullet: 'Alles <b>zusammengerechnet</b>', act: async (a) => {
        await a.scrollBy(-6000);
        await a.tap(a.tab('Zutaten'));
      } },
      { say: 'Abhaken, was da ist – dann fehlt beim Kochen nichts.', act: async (a) => {
        const checks = a.frame.locator('.shop .check');
        for (let k = 0; k < 4; k++) await a.tap(checks.nth(k));
      } },
      { say: 'Jedes Rezept gibt es auch als PDF, genauso aufgebaut, mit den gerade gewählten Mengen.', bullet: 'Jedes Rezept als <b>PDF</b>', act: async (a) => {
        await a.tap(a.button('⤓ PDF'));
        await a.wait(0.4);
        await a.paper('/__media/schweinerucken-pdf.png');
      }, hold: 2.5 },
    ],
  },
  {
    kicker: 'Feedback',
    heading: 'Was nächstes Mal besser wird',
    enter: async (a) => {
      await a.paper(null);
      await openRecipe(a, 'Brownies');
    },
    steps: [
      { say: 'Nach dem Essen schreibt man kurz auf, was beim nächsten Mal anders sein soll. Mit Namen und Uhrzeit, zu genau dieser Version.', bullet: 'Feedback <b>je Version</b>', act: async (a) => {
        await a.tap(a.tab(/Feedback/));
        await a.type(a.frame.locator('#fb'), 'Etwas zu süß – nächstes Mal 260 g Zucker statt 300 g.', 45);
        await a.tap(a.button('Speichern'));
      } },
      { say: 'Feedback lässt sich jederzeit bearbeiten oder löschen.', act: async (a) => {
        await a.ring(a.frame.locator('.comment').first());
      } },
    ],
  },
  {
    kicker: 'Versionen',
    heading: 'Jede Änderung eine neue Version',
    steps: [
      { say: 'Daraus entsteht die nächste Version. Beim Bearbeiten steht das Feedback gleich oben.', bullet: 'Bearbeiten mit <b>Feedback</b>', act: async (a) => {
        await a.ring(null);
        await a.scrollBy(-4000);
        await a.tap(a.link('✎ Bearbeiten'));
        await a.wait(0.8);
        await a.ring(a.frame.locator('details.card').first());
      } },
      { say: 'Das Rezept ist ein einfacher Text. Hier wird der Zucker angepasst, dazu eine kurze Notiz, was und warum.', act: async (a) => {
        await a.ring(null);
        const ta = a.frame.getByRole('textbox', { name: 'Rezepttext' });
        await ta.evaluate((e) => {
          const t = e as HTMLTextAreaElement;
          t.value = t.value.replace('- 300 g Zucker', '- 260 g Zucker');
          const i = t.value.indexOf('- 260 g Zucker');
          t.focus();
          t.setSelectionRange(i, i + 14);
          t.dispatchEvent(new Event('input', { bubbles: true }));
          const line = t.value.slice(0, i).split('\n').length;
          t.scrollTop = Math.max(0, (line - 6) * 22);
        });
        await a.ring(ta);
        await a.wait(1.5);
        await a.ring(null);
        await a.type(a.frame.locator('#msg'), 'Weniger Zucker, war zu süß', 45);
      } },
      { say: 'Gespeichert ist das Version zwei. Die alte bleibt erhalten, wie bei einem Commit.', bullet: 'Alte Versionen <b>bleiben</b>', act: async (a) => {
        await a.tap(a.button('Als Version 2 speichern'));
        await a.wait(1);
        await a.ring(a.frame.locator('.facts'));
      } },
      { say: 'Unter Versionen sieht man, was sich geändert hat – und auf Wunsch jede Zeile.', bullet: 'Unterschiede <b>auf einen Blick</b>', act: async (a) => {
        await a.ring(null);
        await a.tap(a.tab(/Versionen/));
        await a.wait(0.5);
        await a.ring(a.frame.locator('.version').first());
        await a.tap(a.frame.locator('.version').first().getByRole('button', { name: 'Unterschiede' }));
      } },
      { say: 'Und mit einem Tipp gehen Rezept, Verlauf und alles Feedback an eine KI, die die nächste Version vorschlägt.', bullet: 'Für <b>KI</b> kopieren', act: async (a) => {
        await a.ring(null);
        await a.tap(a.tab(/Feedback/));
        await a.ring(a.button('📋 Für KI kopieren'));
      } },
    ],
  },
  {
    kicker: 'Zugang',
    heading: 'Einladung statt Passwort',
    steps: [
      { say: 'Herdgang ist privat. Hinein kommt man nur mit einer Einladung, angemeldet wird per Passkey – Fingerabdruck, Gesicht oder Geräte-PIN.', bullet: 'Einladung + <b>Passkey</b>', act: async (a) => {
        await a.ring(null);
        await a.tap(a.link('Einstellungen'));
      } },
      { say: 'Einladen geht direkt in der App, mit QR-Code für das iPad der Kinder.', bullet: 'QR-Code <b>zum Scannen</b>', act: async (a) => {
        await a.scrollTo(a.frame.locator('#inv-name'), 240);
        await a.type(a.frame.locator('#inv-name'), 'Ben', 120);
        await a.tap(a.button('Einladung erstellen'));
        await a.wait(0.6);
        await a.scrollTo(a.frame.locator('.qr'), 200);
      } },
      { say: 'Wer lesen und Feedback schreiben darf, wer Rezepte bearbeitet und wer einlädt, legt man dabei fest. Jedes Kochbuch ist für sich.', bullet: 'Rollen je <b>Kochbuch</b>' },
      { say: 'Die Rezepte liegen auf unserem eigenen Server und auf jedem Gerät – auch ohne Netz in der Küche.', bullet: 'Eigener Server, <b>offline</b> nutzbar' },
    ],
  },
  {
    kicker: 'Fazit',
    heading: 'Kochen von oben nach unten',
    steps: [
      { say: 'Von oben nach unten kochen, Timer antippen, und danach kurz notieren, was besser werden soll.', bullet: 'Kochen, <b>notieren</b>, verbessern' },
      { say: 'So wird jedes Rezept mit jedem Mal ein bisschen besser.', card: 'outro-card', hold: 2 },
    ],
  },
];
