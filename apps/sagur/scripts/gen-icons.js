// Dependency-free icon generator: draws the Sagur mark (a signed-off check on a
// rounded square) and writes raw PNGs. Run with: node scripts/gen-icons.js
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ACCENT = [31, 111, 235];
const INK = [255, 255, 255];
const SS = 4; // supersampling factor, for smooth edges without a graphics lib

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function encodePNG(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // RGBA

  const stride = size * 4;
  const raw = Buffer.alloc((stride + 1) * size);
  for (let y = 0; y < size; y++) {
    raw[y * (stride + 1)] = 0; // filter: none
    rgba.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }

  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function insideRoundedRect(x, y, left, top, size, radius) {
  const right = left + size;
  const bottom = top + size;
  if (x < left || x >= right || y < top || y >= bottom) return false;
  const cx = x < left + radius ? left + radius : x > right - radius ? right - radius : x;
  const cy = y < top + radius ? top + radius : y > bottom - radius ? bottom - radius : y;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= radius * radius;
}

/** Distance from a point to a segment — used to draw the check with round caps. */
function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / lengthSq));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

function drawIcon(size, { padding = 0, opaque = false } = {}) {
  const hi = size * SS;
  const inset = padding * SS;
  const plate = hi - inset * 2;
  const radius = plate * 0.22;

  const check = [
    { x: 0.28, y: 0.52 },
    { x: 0.44, y: 0.68 },
    { x: 0.74, y: 0.34 },
  ].map((point) => ({ x: inset + point.x * plate, y: inset + point.y * plate }));
  const stroke = plate * 0.085;

  const out = Buffer.alloc(size * size * 4);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let plateHits = 0;
      let inkHits = 0;
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px = x * SS + sx + 0.5;
          const py = y * SS + sy + 0.5;
          if (!insideRoundedRect(px, py, inset, inset, plate, radius)) continue;
          plateHits++;
          const onCheck =
            distanceToSegment(px, py, check[0].x, check[0].y, check[1].x, check[1].y) <= stroke ||
            distanceToSegment(px, py, check[1].x, check[1].y, check[2].x, check[2].y) <= stroke;
          if (onCheck) inkHits++;
        }
      }

      const samples = SS * SS;
      const coverage = plateHits / samples;
      const inkCoverage = inkHits / samples;
      const i = (y * size + x) * 4;

      // Blend the white check over the accent plate, then the plate over nothing.
      const mix = (channel) => {
        const base = ACCENT[channel] * (coverage - inkCoverage) + INK[channel] * inkCoverage;
        return coverage === 0 ? 0 : Math.round(base / coverage);
      };

      if (coverage === 0) {
        if (opaque) {
          out[i] = ACCENT[0];
          out[i + 1] = ACCENT[1];
          out[i + 2] = ACCENT[2];
          out[i + 3] = 255;
        }
        continue;
      }
      out[i] = mix(0);
      out[i + 1] = mix(1);
      out[i + 2] = mix(2);
      out[i + 3] = opaque ? 255 : Math.round(coverage * 255);
    }
  }
  return out;
}

const outDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

const files = [
  { name: 'icon-192.png', size: 192, opts: {} },
  { name: 'icon-512.png', size: 512, opts: {} },
  // Maskable icons get cropped by the launcher, so the mark sits in a safe zone.
  { name: 'icon-maskable-512.png', size: 512, opts: { padding: 56, opaque: true } },
  // iOS applies its own mask and ignores transparency.
  { name: 'apple-touch-icon.png', size: 180, opts: { opaque: true } },
];

for (const file of files) {
  const png = encodePNG(file.size, drawIcon(file.size, file.opts));
  fs.writeFileSync(path.join(outDir, file.name), png);
  console.log(`wrote ${file.name} (${png.length} bytes)`);
}
