# Nutrition table

`bls.json` is an extract of the German food composition database:

> Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank.
> Karlsruhe. DOI 10.25826/Data20251217-134202-0

The Max Rubner-Institut publishes the BLS as open data under the license Creative Commons Attribution 4.0
International (CC BY 4.0). This extract keeps code, name and eight values per 100 g of every food (energy in kcal,
fat, saturated fatty acids, carbohydrates, sugars, fibre, protein, salt), rounded to two decimals; nothing else was
changed. It is made from the published spreadsheet `BLS_4_0_Daten_2025_DE.xlsx` with

```sh
node tools/bls.ts <BLS_4_0_Daten_2025_DE.xlsx> nutrition/bls.json
```

Which food an ingredient counts as is Herdgang's own work: `src/recipe/foods.ts` (checked by hand), the choices made
in a cookbook, and a guess by name for everything else (`src/recipe/nutrition.ts`). The values are estimates for a
family kitchen, not a food label.
