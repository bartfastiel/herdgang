# Recipe format

A recipe version is plain text. The parser is `src/recipe/format.ts`; `node tools/check-recipes.ts --show <file>` checks
a file and prints the two-column layout. Keywords are German because the recipes are.

```
# Brownies
Untertitel: one sentence: what it is and what makes it special
Ergibt: 12 Stück                      ← yield, always starting with a number (used for scaling)
Zeit: 30 min Arbeit, 3 h gesamt
Schlagworte: Backen, Kuchen, Süß      ← tags for filtering
Geräte: Auflaufform 20 × 30 cm, Topf  ← equipment
Hinweis: shown above the steps (e.g. „take the butter out of the fridge 1 h before“)
Herkunft: where the recipe comes from (text only, never a link)

## Teig                                ← optional section (a phase such as „Am Vortag“, „Teig“, „Backen“)

- 200 g Zartbitterschokolade, gehackt  ← ingredients used in this step, in the order they go in
- 3 Eier (Größe M) = 150 g, zimmerwarm {why it matters}
Schokolade über dem [Wasserbad]{Direct heat makes chocolate grainy.} schmelzen. **Nicht kochen.**
! A warning (safety or something critical)
Timer: 25 min – Brownies aus dem Ofen nehmen
```

## Rules

- The header ends at the first blank line. Steps are separated by blank lines.
- Ingredient lines (`- `) belong to the step they start. Read from top to bottom they form the complete ingredient
  list. An ingredient used in two steps appears twice with the respective amount.
- `- <amount> <unit> <name>, <note> {info}` – the note follows the first comma.
- **Amounts in grams**, liquids included („250 g Milch“). The app converts to ml/EL/TL on request; volume units in the
  source produce a warning.
- **Countable things as a count**: eggs, egg yolks, sachets (`Päckchen`), cloves (`Zehe`), cubes of yeast (`Würfel`),
  pinches (`Prise`), leaves (`Blatt`). Eggs always with their weight without shell: `- 3 Eier (Größe M) = 150 g`.
- Amounts may be ranges (`7–15 g`), fractions (`½`, `1½`, `1/2`) or approximate (`ca. 200 g`); without an amount the
  ingredient is „to taste“.
- Inline info: `[anchor words]{explanation}`; an explanation without anchor: `…sentence.{explanation}`. Bold: `**…**`.
- `Timer: <duration> – <what to do when it rings>`. Durations: `45 min`, `1 h 30 min`, `90 s`, `10–12 min` (rings at
  the lower bound). The text is the notification on a locked phone, so it must make sense on its own.
- No links anywhere in a recipe.
- A section whose title starts with `Variante` is optional: its ingredients are not part of the nutrition facts.

## Nutrition facts

The app computes them from the ingredients (`src/recipe/nutrition.ts`). What helps:

- Weights for everything that counts: `- 2 Doraden = 800 g`, `- 1 Packung Flammkuchenteig = 260 g`. Without a weight
  (and without a known piece weight) an ingredient is listed as „not counted“.
- `Ergibt:` with a count („12 Stück“, „4 Portionen“) gives values per piece or portion; a finished weight („1 Brot (ca.
  750 g)“, „450 g“, „2 Gläser (je etwa 150 g)“) adds values per 100 g.
- Salt goes into the cooking water in the step with the pot of water (`- 4000 g Wasser`) or with words like
  „Kochwasser“, „Salzwasser“, „abgießen“ – then only 10 % count. Fat counts 10 % when the step deep-fries („frittieren“,
  „ausbacken“, „schwimmen“, „… cm hoch“) or the ingredient is „Frittierfett“.
- Spices, dried herbs and flavourings count as nothing; the BLS does not list most of them and they hardly weigh
  anything.

## Writing good recipes

- Chronological: every action where it happens in time; preheating, putting water on to boil and resting times where
  they must start. Use waiting times for parallel work.
- Info texts (typically 4–8 per recipe) explain *why* something matters at this point, or how to tell that it is done.
- Concrete checks instead of vague words: temperature, rack position, pan size, doneness test, colour, consistency.
- Every waiting, rising, baking, cooking or resting time gets a timer with a concrete action.

## Versions from feedback (for agents)

Feedback is stored per version. To write the next version on the server:

```sh
node /srv/server/cli.mjs context <recipe>            # current source, history and all feedback
node /srv/server/cli.mjs show <recipe> > recipe.txt  # edit this file
node /srv/server/cli.mjs commit <recipe> --parent <current version> --author "<name>" --message "what and why" < recipe.txt
```

`--parent` makes the commit fail if someone saved a newer version in the meantime: read again, then decide.
