// Generates resources/icons/{icon.png,tray.png,512x512.png,...} with no image deps.
// Mark: a black/white magpie crescent with a blue wing flash on a dark tile.
import { deflateSync } from 'node:zlib';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'resources', 'icons');
mkdirSync(out, { recursive: true });

const crcTable = Array.from({ length: 256 }, (_, n) => {
  let c = n;
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});
const crc32 = (buf) => {
  let c = 0xffffffff;
  for (const b of buf) c = crcTable[(c ^ b) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
};
const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const td = Buffer.concat([Buffer.from(type), data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(td));
  return Buffer.concat([len, td, crc]);
};
function png(size, rgba) {
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0);
  ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  const raw = Buffer.alloc((size * 4 + 1) * size);
  for (let y = 0; y < size; y++) rgba.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4);
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

// Shape sampler in unit coords (0..1). Returns [r,g,b,a] or null.
function sample(x, y, { tile }) {
  const inRoundRect = (px, py, r) => {
    const cx = Math.min(Math.max(px, r), 1 - r);
    const cy = Math.min(Math.max(py, r), 1 - r);
    return (px - cx) ** 2 + (py - cy) ** 2 <= r * r;
  };
  const disc = (cx, cy, r) => (x - cx) ** 2 + (y - cy) ** 2 <= r * r;
  let color = null;
  if (tile && inRoundRect(x, y, 0.22)) color = [29, 32, 38, 255];
  // White body disc, black head/back disc overlapping → crescent.
  if (disc(0.5, 0.52, 0.32)) color = [245, 246, 248, 255];
  if (disc(0.4, 0.42, 0.27)) color = [12, 13, 16, 255];
  // Blue wing flash.
  const wx = x - 0.62;
  const wy = y - 0.62;
  if (Math.abs(wx * 0.7 + wy * 0.7) < 0.05 && Math.abs(-wx * 0.7 + wy * 0.7) < 0.16 && disc(0.5, 0.52, 0.32)) color = [76, 141, 255, 255];
  // Eye.
  if (disc(0.33, 0.36, 0.035)) color = [245, 246, 248, 255];
  return color;
}

function render(size, opts) {
  const ss = 4;
  const buf = Buffer.alloc(size * size * 4);
  for (let py = 0; py < size; py++) {
    for (let px = 0; px < size; px++) {
      let r = 0, g = 0, b = 0, a = 0;
      for (let sy = 0; sy < ss; sy++) {
        for (let sx = 0; sx < ss; sx++) {
          const c = sample((px + (sx + 0.5) / ss) / size, (py + (sy + 0.5) / ss) / size, opts);
          if (c) {
            r += c[0] * c[3];
            g += c[1] * c[3];
            b += c[2] * c[3];
            a += c[3];
          }
        }
      }
      const i = (py * size + px) * 4;
      if (a) {
        buf[i] = Math.round(r / a);
        buf[i + 1] = Math.round(g / a);
        buf[i + 2] = Math.round(b / a);
      }
      buf[i + 3] = Math.round(a / (ss * ss));
    }
  }
  return png(size, buf);
}

writeFileSync(join(out, 'icon.png'), render(512, { tile: true }));
for (const s of [16, 32, 48, 64, 128, 256, 512]) writeFileSync(join(out, `${s}x${s}.png`), render(s, { tile: true }));
writeFileSync(join(out, 'tray.png'), render(32, { tile: false }));
writeFileSync(join(out, 'tray@2x.png'), render(64, { tile: false }));
console.log('icons written to', out);
