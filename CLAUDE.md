# Herdgang – notes for Claude

Daniel's private project (not uCORE; uCORE rules and tools do not apply). A recipe PWA for his family cookbook, optimised
for the process of cooking. Public repository under MIT license; **repository language is English** (code, comments,
docs, commit messages). Talk to Daniel in German; the app's UI and the recipes are German.

## Commands

```sh
npm run dev | typecheck | test | build | e2e
node tools/check-recipes.ts [--show] <file|dir>   # check recipe sources, print the two-column preview
node tools/look.mjs <out dir> home "r:<title>" …  # screenshots against a local backend on :4180 (data in .local/data)
node tools/invite-pdf.ts --name <name> --cookbook <name> --link <url> --expires <iso> --out <file.pdf>
npm run video                                      # explainer video from local data (.local/), never into the repo
tools/hg.sh <cli command>                          # the CLI on the server (recipes, show, context, commit, invite …)
```

## Decisions (2026-10-21)

- **Frame like Hautkarte/Heizung/Triggerfinder**: PWA, vanilla TypeScript, esbuild, `node --test`, Playwright; sign-in
  only by invite link + passkey, cookie `__Host-hg`, Caddy `forward_auth`; local-first (IndexedDB), sync via
  `/api/records?cookbook=…`. No runtime dependencies, no frameworks.
- **Name**: Herdgang (Herd + Hergang). Checked: no app or trademark of that name found.
- **Tenancy**: users ↔ cookbooks via `members` with roles owner/editor/reader. The first invites all point to
  „Daniels Kochbuch“. One IndexedDB per cookbook. Readers may only write comments; comments only by their author (or an
  owner); revisions are immutable (server rejects changes).
- **Recipes only in the database, never in the repo** (Daniel's wish, also for rights reasons). The only recipe in the
  repo is the synthetic `tests/fixtures/sample.txt`. Daniel's recipes were rewritten completely from his Telegram
  collection (own wording, own gram amounts, his family notes worked in) and imported with the CLI; sources are kept
  locally in `.local/recipes/` (git-ignored).
- **Recipe = plain text** (`docs/recipe-format.md`). Revisions store the full source; diffs are line diffs plus a summary
  of changed amounts. Agents write new versions with `cli.mjs commit --parent <n>` (conflict guard).
- **Units**: grams by default, ml/EL/TL by tapping the amount; countables as counts with grams on request
  (`src/recipe/units.ts`, rough densities and piece weights).
- **Timers (Daniel, 2026-10-21)**: per step, several at once, ringing like an alarm clock with the step's text.
  In-app alarm: `<audio>` unlocked by the starting tap (media playback ignores the silent switch), vibration, full-screen
  notice, screen wake lock while timers run. Background: Web Push from the server at the due time (VAPID + aes128gcm,
  `server/push.ts`, iOS only as home-screen app). A real alarm that overrides „silent“ in the background would need a
  native shell (like Hautkarte's Android app) – not built.
- **No end-to-end encryption of records** (decision 2026-10-21): recipes are not sensitive, and agents must be able to
  read feedback on the server. Minimal data instead: first names only, passkeys, hashed session tokens, noindex, strict
  CSP. Push payloads are encrypted per Web Push standard.
- **PDF and QR without libraries**: `src/pdf/pdf.ts` writes PDFs with the standard Helvetica fonts (WinAnsi; characters
  outside are replaced), `src/qr.ts` generates QR codes (checked against an independent decoder).
- **No links in the repository** (Daniel's wish): no URLs, no references to recipe platforms. The live host name lives
  in the repository variable `HERDGANG_HOST`, not in the code.
- **Browsers**: down to Safari 14.1 (older iPads). No lookbehind regexes, no `Array.prototype.at`, no
  `structuredClone`, no `crypto.randomUUID` in the app.

## Rules

- Only relative paths in the app (runs under `/` and `/<path>/pr-<nr>/`); API always `/api/…`; navigation via the hash.
- CSP without `unsafe-inline`: no `style` attributes in markup.
- No browser dialogs (alert/confirm). Deleting is two-step (`confirmButton`).
- Tap targets ≥ 44 px, layout for 412 px first, no horizontal overflow (E2E checks it).
- No attribution to AI tools in code or comments.
- Work in branches and pull requests; CI must be green. Conventional Commits in English (`feat|fix|docs|test|refactor|chore|ci`).
- **Daniel's real recipes only through the CLI** (`tools/hg.sh commit … --parent n`), never with ad-hoc SQL. Before
  larger changes: `cli.mjs backup`.

## Hosting

Same server as frag-daniel, Hautkarte, Heizung: static files via SSH to `/mnt/frag-daniel/herdgang/app`, backend to
`/mnt/frag-daniel/herdgang/server` (container `frag-daniel-herdgang-api-1`, node:24-alpine, data in
`/mnt/frag-daniel/herdgang-data`). Caddy snippet `herdgang` and the container live in the frag-daniel repository
(`infra/Caddyfile.prod`, `infra/compose.prod.yml`), the nightly backup in `/usr/local/bin/frag-daniel-backup`.
Secrets `DEPLOY_HOST`, `DEPLOY_USER`, `DEPLOY_SSH_KEY`; variables `HERDGANG_HOST`, `HERDGANG_PREVIEW_PATH`.
