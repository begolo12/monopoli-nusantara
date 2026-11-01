/* Membuat ikon PWA (PNG) tanpa dependensi: dadu kertas-tinta khas permainan.
   Jalankan: node make-icons.mjs */
import { deflateSync } from 'node:zlib';
import { writeFileSync } from 'node:fs';

/* ---- PNG encoder minimal (RGBA, 8-bit) ---- */
function crc32(buf) {
  let c = ~0;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let k = 0; k < 8; k++) c = (c >>> 1) ^ (0xedb88320 & -(c & 1));
  }
  return ~c >>> 0;
}
function chunk(type, data) {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(body), 0);
  return Buffer.concat([len, body, crc]);
}
function png(w, h, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4);
  ihdr[8] = 8; ihdr[9] = 6; // 8-bit RGBA
  const raw = Buffer.alloc((w * 4 + 1) * h);
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0; // filter: none
    rgba.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4);
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0))
  ]);
}

/* ---- gambar: dadu tinta di atas kertas, anti-alias via supersampling ---- */
const PAPER = [245, 241, 229];
const INK = [33, 36, 43];

function insideRound(x, y, x0, y0, x1, y1, r) {
  if (x < x0 || x > x1 || y < y0 || y > y1) return false;
  const dx = Math.max(x0 + r - x, x - (x1 - r), 0);
  const dy = Math.max(y0 + r - y, y - (y1 - r), 0);
  return dx * dx + dy * dy <= r * r;
}
function insideCircle(x, y, cx, cy, r) {
  const dx = x - cx, dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function drawIcon(size, maskable) {
  const SS = 4; // supersampling per piksel
  const rgba = Buffer.alloc(size * size * 4);
  const m = size * (maskable ? 0.26 : 0.15);           // margin dadu
  const r = size * 0.13;                                // sudut membulat
  const pipR = size * 0.062;
  const span = size - 2 * m;
  const pips = [
    [m + span * 0.26, m + span * 0.26], [m + span * 0.74, m + span * 0.26],
    [m + span * 0.5, m + span * 0.5],
    [m + span * 0.26, m + span * 0.74], [m + span * 0.74, m + span * 0.74]
  ];
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let die = 0, pip = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x + (sx + 0.5) / SS, py = y + (sy + 0.5) / SS;
          if (insideRound(px, py, m, m, size - m, size - m, r)) {
            die++;
            if (pips.some((p) => insideCircle(px, py, p[0], p[1], pipR))) pip++;
          }
        }
      }
      const dieA = die / (SS * SS), pipA = pip / (SS * SS);
      // latar kertas -> badan dadu tinta -> titik kertas
      let out = PAPER.slice();
      out = out.map((c, i) => Math.round(c * (1 - dieA) + INK[i] * dieA));
      out = out.map((c, i) => Math.round(c * (1 - pipA) + PAPER[i] * pipA));
      const o = (y * size + x) * 4;
      rgba[o] = out[0]; rgba[o + 1] = out[1]; rgba[o + 2] = out[2]; rgba[o + 3] = 255;
    }
  }
  return png(size, size, rgba);
}

writeFileSync(new URL('./icon-192.png', import.meta.url), drawIcon(192, false));
writeFileSync(new URL('./icon-512.png', import.meta.url), drawIcon(512, false));
writeFileSync(new URL('./icon-maskable-512.png', import.meta.url), drawIcon(512, true));
console.log('ikon dibuat: icon-192.png, icon-512.png, icon-maskable-512.png');
