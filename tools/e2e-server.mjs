// Backend for the end-to-end tests: starts with an empty database (DATA_DIR is removed first).
import { rmSync } from 'node:fs';

rmSync(process.env.DATA_DIR || 'test-results/e2e-data', { recursive: true, force: true });
await import('../dist-server/main.mjs');
