// Converts the German food composition database (Bundeslebensmittelschlüssel, BLS 4.0, Max Rubner-Institut,
// CC BY 4.0) into the compact nutrition/bls.json the app loads on demand. No dependencies: an xlsx file is a ZIP
// archive with XML inside; only the first sheet is read.
//
//   node tools/bls.ts <BLS_4_0_Daten_2025_DE.xlsx> [nutrition/bls.json]
//
// The xlsx comes in the archive BLS_4_0_2025_DE.zip, published by the Max Rubner-Institut as open data.
import { readFileSync, writeFileSync } from 'node:fs';
import { inflateRawSync } from 'node:zlib';
import { NUTRIENTS, type FoodFile } from '../src/recipe/nutrition.ts';

/** BLS component per nutrient of the app, in the order of NUTRIENTS */
const COMPONENTS: Record<string, string> = {
  kcal: 'ENERCC',
  fat: 'FAT',
  saturated: 'FASAT',
  carbs: 'CHO',
  sugar: 'SUGAR',
  fibre: 'FIBT',
  protein: 'PROT625',
  salt: 'NACL',
};

export const SOURCE =
  'Max Rubner-Institut (2025): Bundeslebensmittelschlüssel (BLS), Version 4.0 – Deutsche Nährstoffdatenbank. Karlsruhe. DOI 10.25826/Data20251217-134202-0';
export const LICENSE =
  'CC BY 4.0 (Creative Commons Namensnennung 4.0 International). Auszug: Code, Name und acht Nährwerte je 100 g, auf zwei Nachkommastellen gerundet, sonst unverändert.';

function zipEntry(zip: Buffer, name: string): Buffer {
  let eocd = zip.length - 22;
  while (eocd >= 0 && zip.readUInt32LE(eocd) !== 0x06054b50) eocd--;
  if (eocd < 0) throw new Error('not a ZIP file');
  const count = zip.readUInt16LE(eocd + 10);
  let p = zip.readUInt32LE(eocd + 16);
  for (let i = 0; i < count; i++) {
    if (zip.readUInt32LE(p) !== 0x02014b50) throw new Error('broken ZIP directory');
    const method = zip.readUInt16LE(p + 10);
    const size = zip.readUInt32LE(p + 20);
    const nameLen = zip.readUInt16LE(p + 28);
    const extraLen = zip.readUInt16LE(p + 30);
    const commentLen = zip.readUInt16LE(p + 32);
    const local = zip.readUInt32LE(p + 42);
    if (zip.toString('utf8', p + 46, p + 46 + nameLen) === name) {
      const start = local + 30 + zip.readUInt16LE(local + 26) + zip.readUInt16LE(local + 28);
      const data = zip.subarray(start, start + size);
      if (method === 0) return Buffer.from(data);
      if (method === 8) return inflateRawSync(data);
      throw new Error('unsupported compression ' + method);
    }
    p += 46 + nameLen + extraLen + commentLen;
  }
  throw new Error('missing in the ZIP file: ' + name);
}

const unescape = (s: string) =>
  s
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&amp;/g, '&');

function column(ref: string): number {
  let n = 0;
  for (const ch of ref) n = n * 26 + (ch.charCodeAt(0) - 64);
  return n - 1;
}

export function convert(xlsx: Buffer): FoodFile {
  const shared: string[] = [];
  const sst = zipEntry(xlsx, 'xl/sharedStrings.xml').toString('utf8');
  for (const m of sst.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unescape(m[1].replace(/<[^>]+>/g, '')));
  const sheet = zipEntry(xlsx, 'xl/worksheets/sheet1.xml').toString('utf8');
  let wanted: number[] | null = null;
  const foods: FoodFile['foods'] = [];
  for (const rm of sheet.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
    const cells: string[] = [];
    for (const cm of rm[1].matchAll(/<c r="([A-Z]+)\d+"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
      const v = cm[3] ? /<v>([\s\S]*?)<\/v>/.exec(cm[3]) : null;
      let value = v ? v[1] : cm[3] ? (/<t[^>]*>([\s\S]*?)<\/t>/.exec(cm[3]) || [])[1] || '' : '';
      if (/t="s"/.test(cm[2]) && value !== '') value = shared[Number(value)];
      cells[column(cm[1])] = unescape(value);
    }
    if (!wanted) {
      const header = cells;
      wanted = NUTRIENTS.map((n) => {
        const i = header.findIndex((h) => h && h.split(' ')[0] === COMPONENTS[n.key] && /\[/.test(h));
        if (i < 0) throw new Error('column missing in the BLS: ' + COMPONENTS[n.key]);
        return i;
      });
      continue;
    }
    if (!cells[0]) continue;
    const values = wanted.map((i) => {
      const x = Number(cells[i]);
      return cells[i] === undefined || cells[i] === '' || !isFinite(x) ? null : Math.round(x * 100) / 100;
    });
    foods.push([cells[0], cells[1], ...values]);
  }
  return { source: SOURCE, license: LICENSE, nutrients: NUTRIENTS.map((n) => n.key), foods };
}

if (process.argv[1] && /bls\.ts$/.test(process.argv[1])) {
  const input = process.argv[2];
  if (!input) {
    console.error('usage: node tools/bls.ts <BLS_4_0_Daten_2025_DE.xlsx> [nutrition/bls.json]');
    process.exit(1);
  }
  const out = process.argv[3] || 'nutrition/bls.json';
  const data = convert(readFileSync(input));
  // one food per line: readable diffs when a new BLS version comes out
  writeFileSync(out, '{"source":' + JSON.stringify(data.source) + ',\n"license":' + JSON.stringify(data.license) + ',\n"nutrients":' + JSON.stringify(data.nutrients) + ',\n"foods":[\n' + data.foods.map((f) => JSON.stringify(f)).join(',\n') + '\n]}\n');
  console.log(`${data.foods.length} foods, ${data.nutrients.length} nutrients → ${out}`);
}
