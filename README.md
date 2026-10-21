# Herdgang

**Recipes written for the act of cooking.** A small, private web app (PWA) for a family cookbook: few recipes, each one
thought through for the kitchen – not an endless library.

*Herdgang* is a German pun: *Herd* (stove) and *Hergang* (the course of events).

## What makes a Herdgang recipe

- **Ingredients next to the step that uses them**, in the order they go in. Read top to bottom, the left column is also
  the complete ingredient list – for setting everything out or checking that everything is there.
- **Strictly chronological.** No „into the preheated oven“ at the end: preheating appears exactly where you have to
  switch the oven on. Waiting times are used („while the dough rests: …“).
- **An „i“ where it matters**: tapping a marked word explains *why* it matters right here in this recipe (why sift the
  flour, why cold butter, why rest the dough). Hover shows it on desktop.
- **Grams by default.** Tap an amount to see it in ml, tablespoons or teaspoons. Countable things (eggs, sachets,
  cloves) are shown as a count, grams on request.
- **Scaling**: change the yield and every amount follows; fractional eggs show their weight on tap.
- **Kitchen timers** on the steps that need them – any number at once. When one is due it rings like an alarm clock,
  with the step's own text („take the bread out of the oven“), until someone taps „done“. The screen stays on while
  cooking; with notifications enabled the server also sends a push message when the phone is locked.
- **PDF** of every recipe, laid out the same way (two columns, notes under the steps).
- **Versions like commits**: every change is a new, immutable version with a message („20 g more water, dough was too
  stiff“). Older versions stay readable; „differences“ shows a line diff and a summary of changed amounts.
- **Feedback per version** with name and time, editable and deletable by its author. „Copy for AI“ puts the recipe,
  its history and all feedback on the clipboard – the input for writing the next version.
- **Nutrition facts** per portion (or piece, or 100 g where the finished weight is known) and in total, computed from
  the ingredients with the German food composition database (see below). Each ingredient shows the food it counts as;
  people who may edit can choose a different one, which then applies to the whole cookbook. Salt for the cooking water
  and fat for deep-frying count only in part, spices and flavourings not at all, optional variants neither.

## Accounts and cookbooks

- Sign-in only with an **invite link and a passkey** (fingerprint, face or device PIN) – no user name, no password.
- **Multi-tenant**: a *cookbook* is the unit of sharing. People are invited into a cookbook as *owner* (everything,
  including invites), *editor* (recipes and feedback) or *reader* (reading and feedback). A person can belong to several
  cookbooks and switch between them.
- **Local-first**: everything lives in IndexedDB and works offline; changes sync with the server when online (newer
  change wins, deletes as tombstones). Revisions are immutable on the server as well.

## Privacy and encryption

Recipes are not sensitive, and future agents should be able to read feedback and write new versions on the server.
Therefore records are **not end-to-end encrypted**; instead the server keeps as little as possible:

- no e-mail addresses, no real names required – a first name per person, chosen by the inviting owner and editable;
- passkeys only (public keys on the server), session cookies stored as hashes, rate limiting, audit log;
- TLS only, `noindex`, strict CSP without `unsafe-inline`, no trackers, no third-party requests from the app;
- push messages for timers are end-to-end encrypted to the device as the Web Push standard requires (RFC 8291).

## Nutrition data

The values come from the Bundeslebensmittelschlüssel (BLS) 4.0 – Max Rubner-Institut (2025): Bundeslebensmittelschlüssel
(BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI 10.25826/Data20251217-134202-0 – published as open
data under Creative Commons Attribution 4.0 International (CC BY 4.0). `nutrition/bls.json` is an extract (code, name
and eight values per 100 g, rounded); `nutrition/README.md` says how it is made. The app names the source wherever it
shows values. Which food an ingredient counts as is this project's own mapping (`src/recipe/foods.ts`).

## Recipe format

Recipes are stored as plain text (German keywords, as the app's users are German speakers). See
`docs/recipe-format.md`. Recipes themselves are **not** part of this repository; they live only
in the database of each cookbook.

## Development

```sh
npm install
npm run dev        # http://localhost:5173/ (local mode without backend, sample recipe available)
npm run typecheck
npm test           # unit tests: format, units, nutrition, diff, PDF, QR codes, backend (passkeys, roles, push crypto)
npm run e2e        # build + Playwright in Pixel 6 Pro format with a virtual passkey
node tools/check-recipes.ts --show <file.txt>   # check a recipe file and preview its two-column layout
node tools/bls.ts <BLS_4_0_Daten_2025_DE.xlsx>  # rebuild nutrition/bls.json from the published spreadsheet
```

Vanilla TypeScript without runtime dependencies or frameworks, bundled with esbuild. The PDF writer, QR code generator,
WebAuthn verification, CBOR decoder and Web Push encryption are small, self-written modules. Backend: Node 24 with
`node:sqlite` and `node:crypto`.

```
server/            app.ts (HTTP, sign-in, sessions, sync, invites, timers), cookbook.ts (recipes for the CLI), push.ts,
                   webauthn.ts, cbor.ts, db.ts, cli.ts, main.ts
src/recipe/        format.ts (parser), units.ts (grams, kitchen measures, scaling), compare.ts (diff, ingredient list),
                   context.ts (text for writing the next version), nutrition.ts (nutrition facts), foods.ts
                   (ingredient → food)
nutrition/         bls.json (extract of the food composition database, loaded by the app on demand)
src/pdf/           pdf.ts (minimal PDF writer), recipe-pdf.ts, invite-pdf.ts, metrics.ts (font widths)
src/views/         home, recipe (steps, ingredients, feedback, versions), nutrition, editor, settings, help
src/timers.ts      kitchen timers, alarm, push registration
src/qr.ts          QR code generator for invite links
```

## Operation

The backend runs as a Node container behind Caddy, which serves the static app and lets only signed-in sessions
through (`forward_auth` against `/api/auth/check`). Administration happens with the command line inside the container:

```sh
node /srv/server/cli.mjs cookbook-create --name "Our cookbook"
node /srv/server/cli.mjs invite --cookbook "Our cookbook" --name Alex --role owner
node /srv/server/cli.mjs recipes | show <recipe> | context <recipe> | commit <recipe> --message "…" < recipe.txt
node /srv/server/cli.mjs nutrition <recipe> | bls <words> | food "<ingredient>" <code|none|auto>
```

## License

MIT – see `LICENSE`.
