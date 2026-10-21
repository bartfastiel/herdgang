// Builds dist/: hashed script and stylesheet, index.html with relative paths (runs under / and in previews under
// /<path>/pr-<nr>/), manifest, icons, the nutrition table (nutrition/bls.json, hashed) and service worker. Plus
// dist/login/ with a small bundle of its own (without a session only that page is reachable). `--serve` rebuilds on changes and serves dist/ on http://localhost:5173.
//
// Environment: APP_VERSION (shown in the settings; default: package.json version + commit)
//              PREVIEW=1  preview build: no sync with the server, a local database of its own, sample recipe
import { build, context } from 'esbuild';
import { execSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.mjs';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = join(root, 'dist');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
let commit = '';
try {
  commit = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim();
} catch {}
const VERSION = process.env.APP_VERSION || pkg.version + (commit ? ` (${commit})` : '');
const PREVIEW = process.env.PREVIEW === '1';
const SERVE = process.argv.includes('--serve');
const SAMPLE = readFileSync(join(root, 'tests/fixtures/sample.txt'), 'utf8');
const BLS = readFileSync(join(root, 'nutrition/bls.json'));
const BLS_PATH = `assets/bls-${createHash('sha256').update(BLS).digest('hex').slice(0, 10)}.json`;

const options = {
  entryPoints: {
    app: join(root, 'src/main.ts'),
    login: join(root, 'src/login.ts'),
    style: join(root, 'src/styles.css'),
  },
  define: { __PREVIEW__: PREVIEW ? 'true' : 'false', __SAMPLE__: JSON.stringify(PREVIEW || SERVE ? SAMPLE : ''), __BLS__: JSON.stringify(BLS_PATH) },
  bundle: true,
  minify: true,
  format: 'iife',
  // older iPads: Safari 14.1 is the floor (platform passkeys; esbuild cannot lower destructuring for 14.0)
  target: ['es2019', 'safari14.1', 'chrome90', 'firefox90'],
  write: false,
  outdir: join(dist, 'assets'),
  legalComments: 'none',
  logLevel: 'warning',
};

function write(file, content) {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

function emit(result) {
  rmSync(dist, { recursive: true, force: true });
  cpSync(join(root, 'public'), dist, { recursive: true });
  write(join(dist, BLS_PATH), BLS);
  const assets = {};
  const contents = {};
  for (const file of result.outputFiles) {
    const name = file.path.split(/[\\/]/).pop();
    const base = name.replace(/\.(js|css)$/, '');
    const ext = name.endsWith('.css') ? 'css' : 'js';
    const hash = createHash('sha256').update(file.contents).digest('hex').slice(0, 10);
    assets[base] = `assets/${base}-${hash}.${ext}`;
    contents[base] = file.contents;
    if (base !== 'login') write(join(dist, assets[base]), file.contents);
  }
  const head = (css, icon) => `<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="robots" content="noindex, nofollow">
<meta name="referrer" content="no-referrer">
<meta name="theme-color" content="#3f6b3a">
<meta name="apple-mobile-web-app-capable" content="yes">
<meta name="apple-mobile-web-app-title" content="Herdgang">
<link rel="icon" href="${icon}" type="image/svg+xml">
<link rel="stylesheet" href="${css}">`;
  const banner = PREVIEW ? '<div class="notice">Vorschau – eigene Testdaten, kein Abgleich</div>\n' : '';
  write(
    join(dist, 'index.html'),
    `<!doctype html>
<html lang="de" data-version="${esc(VERSION)}">
<head>
${head(assets.style, 'icon.svg')}
<meta name="description" content="Private Rezepte-App.">
<title>Herdgang</title>
<link rel="manifest" href="manifest.webmanifest">
<link rel="apple-touch-icon" href="icon-180.png">
</head>
<body>
<header class="top" id="top"></header>
${banner}<main id="main"><noscript>Herdgang braucht JavaScript.</noscript></main>
<div class="timerbar hidden" id="timerbar" aria-label="Laufende Timer"></div>
<script src="${assets.app}" defer></script>
</body>
</html>
`,
  );
  // sign-in page: script and style live next to it, because everything outside /login/ needs a session
  const loginJs = assets.login.replace('assets/', '');
  const loginCss = assets.style.replace('assets/', '');
  write(join(dist, 'login', loginJs), contents.login);
  write(join(dist, 'login', loginCss), contents.style);
  write(
    join(dist, 'login', 'index.html'),
    `<!doctype html>
<html lang="de">
<head>
${head(loginCss, '/icon.svg')}
<title>Herdgang – Anmelden</title>
<link rel="manifest" href="/manifest.webmanifest">
<link rel="apple-touch-icon" href="/icon-180.png">
</head>
<body class="login">
<header class="top"><span class="brand"><img src="/icon.svg" alt="" width="30" height="30"> Herdgang</span></header>
<main id="main"></main>
<script src="${loginJs}" defer></script>
</body>
</html>
`,
  );
  write(join(dist, 'robots.txt'), 'User-agent: *\nDisallow: /\n');
  const precache = ['./', assets.app, assets.style, BLS_PATH, 'manifest.webmanifest', 'icon.svg', 'icon-192.png'];
  delete assets.login;
  const version = createHash('sha256').update(precache.join('|')).digest('hex').slice(0, 10);
  write(join(dist, 'sw.js'), readFileSync(join(root, 'src/sw.js'), 'utf8').replace('__VERSION__', version).replace('__FILES__', JSON.stringify(precache)));
  const size = result.outputFiles.reduce((s, f) => s + f.contents.length, 0);
  console.log(`dist/ built: ${Object.values(assets).join(', ')} (${(size / 1024).toFixed(1)} KiB), version ${VERSION}`);
}

if (SERVE) {
  const ctx = await context({ ...options, plugins: [{ name: 'emit', setup: (b) => b.onEnd((r) => (r.errors.length ? undefined : emit(r))) }] });
  await ctx.watch();
  serve(dist, 5173);
} else {
  emit(await build(options));
}
