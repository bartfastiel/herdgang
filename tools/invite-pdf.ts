// Writes an invite as a one-page PDF (QR code, link, first steps) – the same layout the app offers under „Als PDF“.
//   node tools/invite-pdf.ts --name Daniel --cookbook "Daniels Kochbuch" --link <invite link> --expires <ISO date> --out invite.pdf
import { writeFileSync } from 'node:fs';
import { invitePdf } from '../src/pdf/invite-pdf.ts';

const args = process.argv.slice(2);
const opt = (name: string) => {
  const i = args.indexOf('--' + name);
  return i >= 0 ? args[i + 1] : undefined;
};
const name = opt('name');
const cookbook = opt('cookbook');
const link = opt('link');
const out = opt('out');
if (!name || !cookbook || !link || !out) {
  console.error('usage: --name <name> --cookbook <name> --link <url> --expires <ISO date> --out <file.pdf> [--device]');
  process.exit(1);
}
const expires = Date.parse(opt('expires') || '') || Date.now() + 14 * 86400000;
writeFileSync(out, invitePdf({ name, cookbook, link, expires, newDevice: args.includes('--device') }));
console.log('written: ' + out);
