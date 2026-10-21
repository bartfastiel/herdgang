// Minimal PDF writer without libraries: A4 pages with text in the standard fonts Helvetica / Helvetica-Bold /
// Helvetica-Oblique (WinAnsiEncoding, so German umlauts work without embedding a font), lines, rectangles and circles.
// Coordinates are in points from the TOP-left corner; the writer flips them to PDF space.
import { BOLD, REGULAR } from './metrics.ts';

export type Font = 'R' | 'B' | 'I';
export type Rgb = [number, number, number];

export const A4 = { w: 595.28, h: 841.89 };

// WinAnsiEncoding (cp1252): Unicode character → byte
const ENC = new Map<string, number>();
{
  const dec = new TextDecoder('windows-1252');
  for (let b = 32; b < 256; b++) {
    const c = dec.decode(new Uint8Array([b]));
    if (c !== '�' && !ENC.has(c)) ENC.set(c, b);
  }
}
const REPLACE: Record<string, string> = { '≈': 'ca.', '⅓': '1/3', '⅔': '2/3', '⅛': '1/8', '→': '->', '−': '-', ' ': ' ', ' ': ' ', ' ': ' ', '✓': '', '⏱': '', '⏰': '' };

/** text → WinAnsi bytes (as a latin1 string); characters outside the encoding are replaced */
export function encode(s: string): string {
  let out = '';
  for (const c of s) {
    const r = REPLACE[c];
    if (r !== undefined) {
      out += encode(r);
      continue;
    }
    const b = ENC.get(c);
    out += b !== undefined ? String.fromCharCode(b) : c.charCodeAt(0) < 32 ? ' ' : '?';
  }
  return out;
}

export function width(s: string, font: Font, size: number): number {
  const table = font === 'B' ? BOLD : REGULAR;
  let w = 0;
  const e = encode(s);
  for (let i = 0; i < e.length; i++) w += table[e.charCodeAt(i) - 32] || 0;
  return (w * size) / 1000;
}

export interface Run {
  s: string;
  font: Font;
  color?: Rgb;
}

/** wraps runs of mixed fonts into lines no wider than maxWidth (breaks at spaces; overlong words are split) */
export function wrapRuns(runs: Run[], size: number, maxWidth: number): Run[][] {
  const words: Run[] = [];
  for (const r of runs) {
    const parts = r.s.split(/(\s+)/);
    for (const p of parts) if (p) words.push({ ...r, s: p });
  }
  const lines: Run[][] = [];
  let line: Run[] = [];
  let w = 0;
  const flush = () => {
    while (line.length && /^\s+$/.test(line[line.length - 1].s)) line.pop();
    lines.push(line);
    line = [];
    w = 0;
  };
  for (const word of words) {
    const space = /^\s+$/.test(word.s);
    if (space) {
      if (line.length) {
        line.push({ ...word, s: ' ' });
        w += width(' ', word.font, size);
      }
      continue;
    }
    let ww = width(word.s, word.font, size);
    if (w + ww > maxWidth && line.length) flush();
    let rest = word.s;
    while (ww > maxWidth) {
      let k = rest.length - 1;
      while (k > 1 && width(rest.slice(0, k), word.font, size) > maxWidth) k--;
      line.push({ ...word, s: rest.slice(0, k) });
      flush();
      rest = rest.slice(k);
      ww = width(rest, word.font, size);
    }
    line.push({ ...word, s: rest });
    w += ww;
  }
  if (line.length || !lines.length) flush();
  // one text operation per run of the same font and colour (smaller files, better copy & paste)
  return lines.map((l) =>
    l.reduce<Run[]>((acc, r) => {
      const last = acc[acc.length - 1];
      if (last && last.font === r.font && String(last.color) === String(r.color)) last.s += r.s;
      else acc.push({ ...r });
      return acc;
    }, []),
  );
}

export function wrap(s: string, font: Font, size: number, maxWidth: number): string[] {
  return wrapRuns([{ s, font }], size, maxWidth).map((l) => l.map((r) => r.s).join(''));
}

const num = (x: number) => (Math.round(x * 100) / 100).toString();
const rgb = (c: Rgb) => c.map((v) => num(v / 255)).join(' ');
const esc = (s: string) =>
  encode(s).replace(/[\\()]|[\x80-\xff]/g, (c) => (c === '\\' || c === '(' || c === ')' ? '\\' + c : '\\' + c.charCodeAt(0).toString(8).padStart(3, '0')));

export class Pdf {
  private pages: string[][] = [];
  private ops: string[] = [];
  readonly w = A4.w;
  readonly h = A4.h;
  title = '';

  constructor() {
    this.addPage();
  }

  get pageCount(): number {
    return this.pages.length;
  }

  addPage(): void {
    this.ops = [];
    this.pages.push(this.ops);
  }

  /** continue drawing on an earlier page (0-based), e.g. for footers */
  onPage(i: number): void {
    this.ops = this.pages[i];
  }

  text(x: number, y: number, s: string, font: Font, size: number, color: Rgb = [0, 0, 0]): void {
    if (!s) return;
    this.ops.push(`BT /F${font} ${num(size)} Tf ${rgb(color)} rg ${num(x)} ${num(this.h - y)} Td (${esc(s)}) Tj ET`);
  }

  /** a line of runs starting at x (baseline y); returns its width */
  runs(x: number, y: number, line: Run[], size: number, color: Rgb = [0, 0, 0]): number {
    let cx = x;
    for (const r of line) {
      this.text(cx, y, r.s, r.font, size, r.color || color);
      cx += width(r.s, r.font, size);
    }
    return cx - x;
  }

  rect(x: number, y: number, w: number, h: number, fill: Rgb): void {
    this.ops.push(`${rgb(fill)} rg ${num(x)} ${num(this.h - y - h)} ${num(w)} ${num(h)} re f`);
  }

  line(x1: number, y1: number, x2: number, y2: number, lw: number, color: Rgb): void {
    this.ops.push(`${rgb(color)} RG ${num(lw)} w ${num(x1)} ${num(this.h - y1)} m ${num(x2)} ${num(this.h - y2)} l S`);
  }

  circle(cx: number, cy: number, r: number, fill: Rgb): void {
    const k = 0.5523 * r;
    const y = this.h - cy;
    this.ops.push(
      `${rgb(fill)} rg ${num(cx + r)} ${num(y)} m ${num(cx + r)} ${num(y + k)} ${num(cx + k)} ${num(y + r)} ${num(cx)} ${num(y + r)} c ` +
        `${num(cx - k)} ${num(y + r)} ${num(cx - r)} ${num(y + k)} ${num(cx - r)} ${num(y)} c ` +
        `${num(cx - r)} ${num(y - k)} ${num(cx - k)} ${num(y - r)} ${num(cx)} ${num(y - r)} c ` +
        `${num(cx + k)} ${num(y - r)} ${num(cx + r)} ${num(y - k)} ${num(cx + r)} ${num(y)} c f`,
    );
  }

  /** the finished file */
  bytes(): Uint8Array {
    const objs: string[] = [];
    const add = (s: string) => objs.push(s) - 1 + 1;
    const fonts = { R: 'Helvetica', B: 'Helvetica-Bold', I: 'Helvetica-Oblique' };
    const fontIds: Record<string, number> = {};
    for (const [k, name] of Object.entries(fonts)) fontIds[k] = add(`<< /Type /Font /Subtype /Type1 /BaseFont /${name} /Encoding /WinAnsiEncoding >>`);
    const pagesId = objs.length + 1 + this.pages.length * 2;
    const kids: number[] = [];
    for (const ops of this.pages) {
      const content = ops.join('\n');
      const cid = add(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`);
      kids.push(
        add(
          `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 ${num(this.w)} ${num(this.h)}] /Resources << /Font << /FR ${fontIds.R} 0 R /FB ${fontIds.B} 0 R /FI ${fontIds.I} 0 R >> >> /Contents ${cid} 0 R >>`,
        ),
      );
    }
    add(`<< /Type /Pages /Kids [${kids.map((k) => k + ' 0 R').join(' ')}] /Count ${kids.length} >>`);
    const utf16 = (s: string) => {
      let hex = 'FEFF';
      for (let i = 0; i < s.length; i++) hex += s.charCodeAt(i).toString(16).padStart(4, '0').toUpperCase();
      return '<' + hex + '>';
    };
    const info = add(`<< /Title ${utf16(this.title)} /Producer (Herdgang) >>`);
    const catalog = add(`<< /Type /Catalog /Pages ${pagesId} 0 R >>`);
    let out = '%PDF-1.4\n%\xe2\xe3\xcf\xd3\n';
    const offsets: number[] = [];
    objs.forEach((o, i) => {
      offsets.push(out.length);
      out += `${i + 1} 0 obj\n${o}\nendobj\n`;
    });
    const xref = out.length;
    out += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n` + offsets.map((o) => String(o).padStart(10, '0') + ' 00000 n \n').join('');
    out += `trailer\n<< /Size ${objs.length + 1} /Root ${catalog} 0 R /Info ${info} 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
    const bytes = new Uint8Array(out.length);
    for (let i = 0; i < out.length; i++) bytes[i] = out.charCodeAt(i) & 0xff;
    return bytes;
  }
}
