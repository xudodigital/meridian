// The site icon, drawn in code: a rounded square in the theme's primary colour with a monogram (the first letter of
// the site's name) in on-primary, as PNG (a small encoder on node:zlib), as a PNG-in-ICO favicon and as SVG. Google
// does not take SVG favicons, so favicon.ico is the one every page links first. Glyphs are stroked polylines on a
// 6 x 8 grid, so the PNG and the SVG show exactly the same mark; a name without a Latin letter or digit gets three
// text lines instead.
import { crc32, deflateSync } from 'node:zlib';

type Pt = [number, number];
/** One stroke: a polyline in glyph units (x 0-6, y 0-8, y down). */
type Stroke = Pt[];

/** Points along an ellipse from `a0` to `a1` degrees (0 = right, 90 = down), every 6 degrees. */
function arc(cx: number, cy: number, rx: number, ry: number, a0: number, a1: number): Pt[] {
  const n = Math.max(2, Math.ceil(Math.abs(a1 - a0) / 6));
  return Array.from({ length: n + 1 }, (_, i) => {
    const a = (a0 + (a1 - a0) * i / n) * Math.PI / 180;
    return [cx + rx * Math.cos(a), cy + ry * Math.sin(a)] as Pt;
  });
}

const GLYPHS: Record<string, Stroke[]> = {
  A: [[[0, 8], [3, 0], [6, 8]], [[1.1, 5.3], [4.9, 5.3]]],
  B: [[[3.2, 4], [0, 4], [0, 0], [3.1, 0], ...arc(3.1, 2, 2.3, 2, -90, 90)], [[0, 4], [3.5, 4], ...arc(3.5, 6, 2.5, 2, -90, 90), [0, 8], [0, 4]]],
  C: [arc(3.4, 4, 3.4, 4, -42, -318)],
  D: [[[0, 0], [0, 8], [2.2, 8], ...arc(2.2, 4, 3.8, 4, 90, -90), [0, 0]]],
  E: [[[5.6, 0], [0, 0], [0, 8], [5.6, 8]], [[0, 4], [4.4, 4]]],
  F: [[[5.6, 0], [0, 0], [0, 8]], [[0, 4], [4.4, 4]]],
  G: [[...arc(3.4, 4, 3.4, 4, -42, -360), [3.9, 4]]],
  H: [[[0, 0], [0, 8]], [[6, 0], [6, 8]], [[0, 4], [6, 4]]],
  I: [[[3, 0], [3, 8]], [[1.4, 0], [4.6, 0]], [[1.4, 8], [4.6, 8]]],
  J: [[[5, 0], ...arc(2.75, 5.6, 2.25, 2.4, 0, 180)]],
  K: [[[0, 0], [0, 8]], [[5.8, 0], [0, 5.2]], [[1.9, 3.6], [6, 8]]],
  L: [[[0, 0], [0, 8], [5.4, 8]]],
  M: [[[0, 8], [0, 0], [3.2, 5.4], [6.4, 0], [6.4, 8]]],
  N: [[[0, 8], [0, 0], [6, 8], [6, 0]]],
  O: [arc(3.4, 4, 3.4, 4, 0, 360)],
  P: [[[0, 8], [0, 0], [3.4, 0], ...arc(3.4, 2.3, 2.6, 2.3, -90, 90), [0, 4.6]]],
  Q: [arc(3.4, 4, 3.4, 4, 0, 360), [[4.2, 5.9], [6.8, 8.4]]],
  R: [[[0, 8], [0, 0], [3.4, 0], ...arc(3.4, 2.3, 2.6, 2.3, -90, 90), [0, 4.6]], [[3.2, 4.6], [6, 8]]],
  S: [[...arc(3, 2.05, 2.8, 2.05, -20, -270), ...arc(3, 6, 2.95, 2, -90, 160)]],
  T: [[[0, 0], [6.2, 0]], [[3.1, 0], [3.1, 8]]],
  U: [[[0, 0], ...arc(3, 5, 3, 3, 180, 0), [6, 0]]],
  V: [[[0, 0], [3.2, 8], [6.4, 0]]],
  W: [[[0, 0], [1.8, 8], [3.6, 2.4], [5.4, 8], [7.2, 0]]],
  X: [[[0, 0], [6, 8]], [[6, 0], [0, 8]]],
  Y: [[[0, 0], [3.1, 4.2], [6.2, 0]], [[3.1, 4.2], [3.1, 8]]],
  Z: [[[0.2, 0], [6, 0], [0, 8], [6, 8]]],
  0: [arc(3, 4, 3, 4, 0, 360)],
  1: [[[1.2, 1.6], [3.6, 0], [3.6, 8]]],
  2: [[...arc(3, 2.6, 2.8, 2.6, 200, 380), [0, 8], [6, 8]]],
  3: [[...arc(3, 2.05, 2.7, 2.05, -160, 90), ...arc(3, 6, 2.9, 2, -90, 160)]],
  4: [[[4.6, 8], [4.6, 0], [0, 5.6], [6.2, 5.6]]],
  5: [[[5.6, 0], [0.9, 0], [0.5, 3.8], ...arc(3, 5.4, 2.9, 2.6, -135, 150)]],
  6: [[[4.8, 0.2], [0.8, 4.4]], arc(3.1, 5.4, 2.8, 2.6, 0, 360)],
  7: [[[0, 0], [6, 0], [2.2, 8]]],
  8: [arc(3, 2, 2.4, 2, 0, 360), arc(3, 6, 2.9, 2, 0, 360)],
  9: [arc(2.9, 2.6, 2.8, 2.6, 0, 360), [[5.2, 3.6], [1.2, 7.8]]],
};
/** Three lines of text: the mark for a name with no Latin letter or digit. */
const LINES: Stroke[] = [[[0, 1], [6, 1]], [[0, 4], [6, 4]], [[0, 7], [3.6, 7]]];

/** The character the icon shows for a site: the first Latin letter or digit of its name, else of its domain. */
export function monogram(name: string, domain: string): string {
  for (const s of [name, domain.startsWith('xn--') ? '' : domain]) {
    const c = s.normalize('NFD').replace(/[̀-ͯ]/g, '').toUpperCase().match(/[A-Z0-9]/)?.[0];
    if (c) return c;
  }
  return '';
}

/** The strokes of a mark placed in a 64 x 64 box, centred, and the stroke width (also in that box). */
function layout(mark: string): { strokes: Pt[][]; width: number } {
  const glyph = GLYPHS[mark] ?? LINES;
  const xs = glyph.flat().map(p => p[0]), ys = glyph.flat().map(p => p[1]);
  const minX = Math.min(...xs), maxX = Math.max(...xs), minY = Math.min(...ys), maxY = Math.max(...ys);
  /* Cap height a little over half the icon; a wide glyph (W, M) is narrowed to fit. */
  const scale = Math.min(34 / 8, 40 / Math.max(maxX - minX, 1));
  const ox = 32 - (minX + maxX) / 2 * scale, oy = 32 - (minY + maxY) / 2 * scale;
  return { strokes: glyph.map(s => s.map(([x, y]) => [ox + x * scale, oy + y * scale] as Pt)), width: 1.75 * scale };
}

/** Corner radius of the rounded square, in the 64 box (about the M3 extra-large corner at icon scale). */
const RADIUS = 15;

/** The icon as SVG (a 64 x 64 view box). */
export function iconSvg(mark: string, primary: string, onPrimary: string): string {
  const { strokes, width } = layout(mark);
  const d = strokes.map(s => 'M' + s.map(([x, y]) => `${x.toFixed(2)} ${y.toFixed(2)}`).join('L')).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><rect width="64" height="64" rx="${RADIUS}" fill="${primary}"/>` +
    `<path d="${d}" fill="none" stroke="${onPrimary}" stroke-width="${width.toFixed(2)}" stroke-linecap="round" stroke-linejoin="round"/></svg>\n`;
}

/** Distance from p to the segment a-b. */
function segDist(px: number, py: number, a: Pt, b: Pt): number {
  const dx = b[0] - a[0], dy = b[1] - a[1], len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((px - a[0]) * dx + (py - a[1]) * dy) / len)) : 0;
  const x = a[0] + t * dx - px, y = a[1] + t * dy - py;
  return Math.sqrt(x * x + y * y);
}

/**
 * The icon as RGBA pixels, `size` x `size`. Edges are anti-aliased from distances (one sample per pixel). With
 * `full`, the square has no rounded corners (iOS rounds the Apple touch icon itself and shows transparency as black).
 */
export function iconPixels(size: number, mark: string, primary: [number, number, number], onPrimary: [number, number, number], full = false): Uint8Array {
  const { strokes, width } = layout(mark);
  const k = size / 64, half = width * k / 2, r = full ? 0 : RADIUS * k;
  const segs: [Pt, Pt][] = [];
  for (const s of strokes) for (let i = 1; i < s.length; i++) segs.push([[s[i - 1]![0] * k, s[i - 1]![1] * k], [s[i]![0] * k, s[i]![1] * k]]);
  const out = new Uint8Array(size * size * 4);
  const c = size / 2;
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const px = x + 0.5, py = y + 0.5;
    /* Signed distance to the rounded square (negative inside). */
    const qx = Math.abs(px - c) - (c - r), qy = Math.abs(py - c) - (c - r);
    const box = Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r;
    const bg = Math.max(0, Math.min(1, 0.5 - box));
    if (!bg) continue;
    let d = Infinity;
    for (const [a, b] of segs) { const v = segDist(px, py, a, b); if (v < d) d = v; }
    const ink = Math.max(0, Math.min(1, half - d + 0.5));
    const o = (y * size + x) * 4;
    for (let ch = 0; ch < 3; ch++) out[o + ch] = Math.round(primary[ch]! * (1 - ink) + onPrimary[ch]! * ink);
    out[o + 3] = Math.round(bg * 255);
  }
  return out;
}

function chunk(type: string, data: Buffer): Buffer {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** A PNG file (8-bit RGBA, no interlace) of `rgba` pixels, row by row. */
export function encodePng(width: number, height: number, rgba: Uint8Array): Buffer {
  const row = width * 4, raw = Buffer.alloc((row + 1) * height);
  /* Filter "Sub" on every row: icons are runs of one colour, which then compress to almost nothing. */
  for (let y = 0; y < height; y++) {
    const o = y * (row + 1), src = y * row;
    raw[o] = 1;
    for (let i = 0; i < row; i++) raw[o + 1 + i] = (rgba[src + i]! - (i >= 4 ? rgba[src + i - 4]! : 0)) & 255;
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0); ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; ihdr[9] = 6; ihdr[10] = 0; ihdr[11] = 0; ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** An ICO file holding PNG images (supported by every current browser and by Google's favicon crawler). */
export function encodeIco(images: { size: number; png: Buffer }[]): Buffer {
  const head = Buffer.alloc(6 + 16 * images.length);
  head.writeUInt16LE(0, 0); head.writeUInt16LE(1, 2); head.writeUInt16LE(images.length, 4);
  let offset = head.length;
  images.forEach((im, i) => {
    const e = 6 + 16 * i;
    head[e] = im.size >= 256 ? 0 : im.size; head[e + 1] = im.size >= 256 ? 0 : im.size;
    head[e + 2] = 0; head[e + 3] = 0;
    head.writeUInt16LE(1, e + 4); head.writeUInt16LE(32, e + 6);
    head.writeUInt32LE(im.png.length, e + 8); head.writeUInt32LE(offset, e + 12);
    offset += im.png.length;
  });
  return Buffer.concat([head, ...images.map(im => im.png)]);
}

/** The icon as a PNG file. */
export const iconPng = (size: number, mark: string, primary: [number, number, number], onPrimary: [number, number, number], full = false): Buffer =>
  encodePng(size, size, iconPixels(size, mark, primary, onPrimary, full));
