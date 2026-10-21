// Builds the backend into dist-server/ (main.mjs, cli.mjs): one bundle per entry, Node built-ins only. The nutrition
// table goes along for the command line (`nutrition`, `food`).
import { build } from 'esbuild';
import { copyFileSync, rmSync } from 'node:fs';

rmSync('dist-server', { recursive: true, force: true });
await build({
  entryPoints: { main: 'server/main.ts', cli: 'server/cli.ts' },
  bundle: true,
  platform: 'node',
  format: 'esm',
  target: 'node24',
  outdir: 'dist-server',
  outExtension: { '.js': '.mjs' },
  logLevel: 'warning',
});
copyFileSync('nutrition/bls.json', 'dist-server/bls.json');
console.log('dist-server/ built: main.mjs, cli.mjs, bls.json');
