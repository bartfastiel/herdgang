// Prints QR matrices as JSON (used to check the generator against an independent decoder).
import { qr } from '../src/qr.ts';
const texts = JSON.parse(process.argv[2]) as string[];
console.log(JSON.stringify(texts.map((t) => ({ t, m: qr(t).map((r) => r.map((b) => (b ? 1 : 0)).join('')) }))));
