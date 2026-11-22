// Photos of a dish: shrinking a picture from the camera or the gallery before it is stored, and showing it from this
// device or from the server.
import { getBlobs } from './data/store.ts';
import type { Photo } from './data/types.ts';
import { currentCookbook, currentMode } from './sync.ts';
import { h } from './ui/dom.ts';

/** longest side of the stored picture, and the side of the square preview */
const FULL = 1600;
const THUMB = 240;

function load(file: Blob): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    // browsers apply the orientation from the camera's EXIF data when drawing
    img.onload = () => (URL.revokeObjectURL(url), resolve(img));
    img.onerror = () => (URL.revokeObjectURL(url), reject(new Error('Dieses Bild kann der Browser nicht öffnen.')));
    img.src = url;
  });
}

function encode(canvas: HTMLCanvasElement, quality: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Bild konnte nicht gespeichert werden.'))), 'image/jpeg', quality));
}

/** JPEG of at most FULL pixels on the longest side, plus a square preview cut from the middle */
export async function shrink(file: Blob): Promise<{ full: Blob; thumb: Blob; width: number; height: number }> {
  const img = await load(file);
  const w0 = img.naturalWidth;
  const h0 = img.naturalHeight;
  if (!w0 || !h0) throw new Error('Leeres Bild.');
  const scale = Math.min(1, FULL / Math.max(w0, h0));
  const width = Math.round(w0 * scale);
  const height = Math.round(h0 * scale);
  const big = document.createElement('canvas');
  big.width = width;
  big.height = height;
  (big.getContext('2d') as CanvasRenderingContext2D).drawImage(img, 0, 0, width, height);
  const side = Math.min(w0, h0);
  const small = document.createElement('canvas');
  small.width = small.height = THUMB;
  (small.getContext('2d') as CanvasRenderingContext2D).drawImage(img, (w0 - side) / 2, (h0 - side) / 2, side, side, 0, 0, THUMB, THUMB);
  return { full: await encode(big, 0.82), thumb: await encode(small, 0.8), width, height };
}

const urls = new Map<string, string>();

async function source(id: string, size: 'full' | 'thumb'): Promise<string> {
  const key = id + '.' + size;
  const known = urls.get(key);
  if (known) return known;
  const local = await getBlobs(id).catch(() => undefined);
  let url = '';
  if (local) url = URL.createObjectURL(local[size]);
  else {
    const cb = currentCookbook();
    if (currentMode() !== 'server' || !cb) return '';
    url = '/api/photos?cookbook=' + encodeURIComponent(cb.id) + '&id=' + id + '&size=' + size;
  }
  urls.set(key, url);
  return url;
}

/** an <img> for a photo; the address is filled in once known (bytes on this device, or the server) */
export function photoImg(ph: Photo, size: 'full' | 'thumb', cls: string, alt = ''): HTMLImageElement {
  const square = size === 'thumb';
  const img = h('img', { class: cls, alt, loading: 'lazy', decoding: 'async', width: square ? THUMB : ph.width, height: square ? THUMB : ph.height }) as HTMLImageElement;
  void source(ph.id, size).then((src) => {
    if (src) img.src = src;
  });
  return img;
}
