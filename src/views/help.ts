// Short help: how a recipe page works.
import { h } from '../ui/dom.ts';

const ITEMS: [string, string][] = [
  ['Ablauf', 'Links stehen die Zutaten, die in diesem Schritt dazukommen – in der Reihenfolge, in der sie verwendet werden. Von oben nach unten gelesen ist die linke Spalte zugleich die ganze Zutatenliste.'],
  ['Mengen', 'Alles in Gramm, Abzählbares (Eier, Päckchen) als Anzahl. Eine unterstrichene Menge antippen: dann erscheint sie in ml, EL, TL oder als Stückzahl. „≈“ heißt umgerechnet.'],
  ['Portionen', 'Mit − und + rechnet Herdgang alle Mengen um. Die Rezept-Zeiten bleiben gleich, die Form muss evtl. größer werden.'],
  ['Das „i“', 'Ein Wort mit „i“ antippen: kurz erklärt, warum das genau hier wichtig ist.'],
  ['Erledigt', 'Die Schrittnummer antippen, dann wird der Schritt blass – so siehst du, wo du bist.'],
  ['Timer', 'Timer-Knopf beim Schritt antippen, wenn du so weit bist. Mehrere können gleichzeitig laufen; unten steht, wie lange noch. Ist die Zeit um, klingelt es mit dem Text des Schritts, bis du „Erledigt“ tippst.'],
  ['Zutaten', 'Alles zusammengerechnet, zum Einkaufen oder Bereitstellen. Abhaken, was da ist.'],
  ['Nährwerte', 'Unter den Zutaten: ungefähre Werte pro Portion oder Stück, berechnet aus den Zutaten mit dem Bundeslebensmittelschlüssel. „Woher die Werte kommen“ zeigt, als was jede Zutat gerechnet ist – wer Rezepte bearbeiten darf, kann das dort ändern.'],
  ['Rückmeldungen', 'Nach dem Kochen notieren, was beim nächsten Mal anders sein soll. Daraus entsteht die nächste Version.'],
  ['Versionen', 'Jede Änderung ist eine neue Version; ältere bleiben erhalten. „Unterschiede“ zeigt, was sich geändert hat.'],
  ['PDF', 'Speichert das Rezept so, wie es gerade angezeigt wird (mit umgerechneten Mengen), als PDF.'],
];

export function helpView(root: HTMLElement): void {
  root.appendChild(h('h1', null, 'So funktioniert’s'));
  for (const [title, text] of ITEMS) root.appendChild(h('section', { class: 'card' }, h('h3', null, title), h('p', null, text)));
}
