// One-off icon generator (no dependencies): draws a simple rounded-square
// "growth bars" icon and writes it as a raw PNG. Run with: node scripts/gen-icons.js
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

function crc32(buf) {
  return zlib.crc32(buf);
}

function chunk(type, data) {
  const typeBuf = Buffer.from(type, 'ascii');
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crcBuf = Buffer.alloc(4);
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])) >>> 0, 0);
  return Buffer.concat([len, typeBuf, data, crcBuf]);
}

function encodePNG(width, height, rgbaPixels) {
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8; // bit depth
  ihdr[9] = 6; // color type RGBA
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;

  const stride = width * 4;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 0; // filter type: none
    rgbaPixels.copy(raw, y * (stride + 1) + 1, y * stride, y * stride + stride);
  }
  const idatData = zlib.deflateSync(raw, { level: 9 });

  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', idatData),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

function inRoundedRect(x, y, w, h, r) {
  if (x >= r && x < w - r) return y >= 0 && y < h;
  if (y >= r && y < h - r) return x >= 0 && x < w;
  const cx = x < r ? r : w - r;
  const cy = y < r ? r : h - r;
  const dx = x - cx;
  const dy = y - cy;
  return dx * dx + dy * dy <= r * r;
}

function drawIcon(size) {
  const px = Buffer.alloc(size * size * 4);
  const bg = [22, 163, 74, 255]; // emerald-600
  const bar = [255, 255, 255, 255];
  const r = Math.round(size * 0.18);

  // background rounded square
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const i = (y * size + x) * 4;
      if (inRoundedRect(x, y, size, size, r)) {
        px[i] = bg[0]; px[i + 1] = bg[1]; px[i + 2] = bg[2]; px[i + 3] = bg[3];
      } else {
        px[i] = 0; px[i + 1] = 0; px[i + 2] = 0; px[i + 3] = 0;
      }
    }
  }

  // three ascending growth bars, centered
  const bars = [0.40, 0.60, 0.82]; // relative heights
  const barCount = bars.length;
  const gap = size * 0.06;
  const barW = size * 0.14;
  const totalW = barCount * barW + (barCount - 1) * gap;
  const startX = (size - totalW) / 2;
  const baseY = size * 0.78;

  for (let b = 0; b < barCount; b++) {
    const h = size * bars[b] * 0.55;
    const x0 = Math.round(startX + b * (barW + gap));
    const x1 = Math.round(x0 + barW);
    const y0 = Math.round(baseY - h);
    const y1 = Math.round(baseY);
    for (let y = y0; y < y1; y++) {
      for (let x = x0; x < x1; x++) {
        const i = (y * size + x) * 4;
        px[i] = bar[0]; px[i + 1] = bar[1]; px[i + 2] = bar[2]; px[i + 3] = bar[3];
      }
    }
  }

  return px;
}

const outDir = path.join(__dirname, '..', 'public', 'icons');
fs.mkdirSync(outDir, { recursive: true });

for (const size of [192, 512]) {
  const pixels = drawIcon(size);
  const png = encodePNG(size, size, pixels);
  fs.writeFileSync(path.join(outDir, `icon-${size}.png`), png);
  console.log(`wrote icon-${size}.png (${png.length} bytes)`);
}

// apple-touch-icon: iOS ignores transparency/rounding (it applies its own
// mask), so render on an opaque background at 180x180.
{
  const size = 180;
  const px = drawIcon(size);
  for (let i = 0; i < px.length; i += 4) {
    if (px[i + 3] === 0) {
      px[i] = 22; px[i + 1] = 163; px[i + 2] = 74; px[i + 3] = 255;
    }
  }
  const png = encodePNG(size, size, px);
  fs.writeFileSync(path.join(outDir, 'apple-touch-icon.png'), png);
  console.log(`wrote apple-touch-icon.png (${png.length} bytes)`);
}
