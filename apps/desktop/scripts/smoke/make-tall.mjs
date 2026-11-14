import { writeFileSync } from 'node:fs';
import { encode } from './png.mjs';
const W = 900, H = 3000;
let s = 12345; const r = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32);
const px = new Uint8Array(W * H * 4).fill(255);
let y = 20;
while (y < H - 30) {
  if (r() < 0.1) { const h = 60 + Math.floor(r() * 80); for (let yy = y; yy < Math.min(H, y + h); yy++) for (let x = 40; x < W - 40; x++) { const i = (yy * W + x) * 4; px[i] = (x * 2 + yy) & 255; px[i + 1] = (x + yy * 3) & 255; px[i + 2] = (yy * 5 + 80) & 255; } y += h + 20; continue; }
  let x = 40 + Math.floor(r() * 30); const words = 4 + Math.floor(r() * 10);
  for (let k = 0; k < words && x < W - 60; k++) { const ww = 20 + Math.floor(r() * 70); for (let yy = y; yy < y + 16; yy++) for (let xx = x; xx < Math.min(W - 40, x + ww); xx++) if ((xx * 7 + yy * 3) % 5 < 2) { const i = (yy * W + xx) * 4; px[i] = px[i + 1] = px[i + 2] = 40; } x += ww + 10; }
  y += 26 + (r() < 0.15 ? 30 : 0);
}
writeFileSync(process.argv[2], encode(W, H, px));
console.log('tall written', W, H);
