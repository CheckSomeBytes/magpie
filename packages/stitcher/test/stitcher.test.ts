import { describe, expect, it } from 'vitest';
import { Stitcher, type Frame } from '../src';

const W = 320;
const VIEW = 300; // frame height
const HEADER = 40;
const FOOTER = 30;
const CONTENT_VIEW = VIEW - HEADER - FOOTER;

/** Deterministic PRNG. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

/** A "page": text-like lines (random dark blocks) separated by blank space, plus the occasional image band. */
function makePage(height: number, seed = 1): Uint8ClampedArray {
  const r = rng(seed);
  const px = new Uint8ClampedArray(W * height * 4).fill(255);
  let y = 10;
  while (y < height - 20) {
    if (r() < 0.12) {
      // image band
      const h = 30 + Math.floor(r() * 40);
      for (let yy = y; yy < Math.min(height, y + h); yy++)
        for (let x = 0; x < W; x++) {
          const i = (yy * W + x) * 4;
          px[i] = (x * 3 + yy * 2 + seed * 17) & 255;
          px[i + 1] = (x + yy * 5) & 255;
          px[i + 2] = (yy * 7) & 255;
        }
      y += h + 12;
      continue;
    }
    const lineH = 12;
    const words = 3 + Math.floor(r() * 8);
    let x = 8 + Math.floor(r() * 20);
    for (let w = 0; w < words && x < W - 10; w++) {
      const ww = 10 + Math.floor(r() * 40);
      for (let yy = y; yy < y + lineH; yy++)
        for (let xx = x; xx < Math.min(W - 4, x + ww); xx++) {
          if ((xx + yy) % 3 === 0 && r() < 0.8) {
            const i = (yy * W + xx) * 4;
            px[i] = px[i + 1] = px[i + 2] = 30 + Math.floor(r() * 40);
          }
        }
      x += ww + 6;
    }
    y += lineH + 6 + (r() < 0.2 ? 24 : 0); // blank paragraph gaps (flat rows)
  }
  return px;
}

function band(color: [number, number, number], h: number, pattern: boolean): Uint8ClampedArray {
  const px = new Uint8ClampedArray(W * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4;
      const on = pattern && (x % 40 < 20) !== (y % 10 < 5);
      px[i] = on ? 255 : color[0];
      px[i + 1] = on ? 255 : color[1];
      px[i + 2] = on ? 255 : color[2];
      px[i + 3] = 255;
    }
  return px;
}

const HEADER_PX = band([40, 44, 52], HEADER, true);
const FOOTER_PX = band([20, 90, 160], FOOTER, true);

/** Viewport frame at scroll position `s` (content rows s .. s+CONTENT_VIEW). */
function frameAt(page: Uint8ClampedArray, s: number, noise?: () => number): Frame {
  const data = new Uint8ClampedArray(W * VIEW * 4);
  data.set(HEADER_PX, 0);
  data.set(page.subarray(s * W * 4, (s + CONTENT_VIEW) * W * 4), HEADER * W * 4);
  data.set(FOOTER_PX, (HEADER + CONTENT_VIEW) * W * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  if (noise) {
    // ±noise on every channel, plus horizontal chroma smear like I420 conversion.
    for (let i = 0; i < data.length; i += 4) {
      const n = noise();
      data[i]! += n;
      data[i + 1]! += n;
      data[i + 2]! += n;
    }
    for (let i = 4; i < data.length; i += 8) {
      data[i] = (data[i]! + data[i - 4]!) >> 1;
      data[i + 2] = (data[i + 2]! + data[i - 2]!) >> 1;
    }
  }
  return { width: W, height: VIEW, data };
}

/** Expected stitched image for a final scroll position. */
function truth(page: Uint8ClampedArray, last: number): Frame {
  const h = HEADER + last + CONTENT_VIEW + FOOTER;
  const data = new Uint8ClampedArray(W * h * 4);
  data.set(HEADER_PX, 0);
  data.set(page.subarray(0, (last + CONTENT_VIEW) * W * 4), HEADER * W * 4);
  data.set(FOOTER_PX, (HEADER + last + CONTENT_VIEW) * W * 4);
  for (let i = 3; i < data.length; i += 4) data[i] = 255;
  return { width: W, height: h, data };
}

function maxRowError(a: Frame, b: Frame, greenOnly = false): number {
  let worst = 0;
  for (let y = 0; y < Math.min(a.height, b.height); y++) {
    let s = 0;
    for (let x = 0; x < W * 4; x += 4) {
      const i = y * W * 4 + x;
      s += greenOnly ? Math.abs(a.data[i + 1]! - b.data[i + 1]!) : Math.abs(a.data[i]! - b.data[i]!) + Math.abs(a.data[i + 1]! - b.data[i + 1]!);
    }
    worst = Math.max(worst, s / W);
  }
  return worst;
}

function run(page: Uint8ClampedArray, positions: number[], noise?: () => number) {
  const st = new Stitcher();
  const statuses = positions.map((p) => st.addFrame(frameAt(page, p, noise)).status);
  st.finish();
  return { st, statuses, out: st.compose() };
}

describe('Stitcher', () => {
  const page = makePage(2400, 7);

  it('reconstructs a page exactly from uneven scrolling', () => {
    const pos = [0, 0, 18, 55, 90, 90, 160, 171, 240, 320, 400, 401, 470, 560, 650, 700];
    const { st, out, statuses } = run(page, pos);
    expect(statuses[0]).toBe('first');
    expect(statuses[1]).toBe('static');
    expect(st.fixedHeader).toBe(HEADER);
    expect(st.fixedFooter).toBe(FOOTER);
    const want = truth(page, 700);
    expect(out.height).toBe(want.height);
    expect(maxRowError(out, want)).toBe(0);
    expect(st.seams().every((s) => !s.gap)).toBe(true);
  });

  it('ignores scrolling back up', () => {
    const { out, statuses } = run(page, [0, 100, 200, 150, 120, 260, 340]);
    expect(statuses).toContain('reverse');
    const want = truth(page, 340);
    expect(out.height).toBe(want.height);
    expect(maxRowError(out, want)).toBe(0);
  });

  it('survives video-style noise and chroma smear', () => {
    const r = rng(99);
    const { out } = run(page, [0, 40, 95, 150, 230, 300, 380, 455, 530], () => Math.round((r() - 0.5) * 4));
    const want = truth(page, 530);
    expect(out.height).toBe(want.height);
    // Red/blue carry the chroma smear; green carries only ±2 noise, so any misaligned row would show.
    expect(maxRowError(out, want, true)).toBeLessThanOrEqual(2);
  });

  it('keeps memory bounded: small steps become pending, not kept', () => {
    const pos = Array.from({ length: 60 }, (_, i) => i * 8); // 8 px per sample
    const { st, out } = run(page, pos);
    expect(st.frames).toBeLessThan(12);
    expect(out.height).toBe(truth(page, pos.at(-1)!).height);
    expect(maxRowError(out, truth(page, pos.at(-1)!))).toBe(0);
  });

  it('flags a gap when the user scrolls further than a frame', () => {
    const { st, statuses } = run(page, [0, 100, 900]);
    expect(statuses.at(-1)).toBe('gap');
    expect(st.seams().some((s) => s.gap)).toBe(true);
  });

  it('handles repetitive content by preferring overlap and recent speed', () => {
    // Identical cards every 100 rows, scrolled in 60-row steps.
    const card = makePage(100, 3);
    const rep = new Uint8ClampedArray(W * 1500 * 4);
    for (let k = 0; k < 15; k++) rep.set(card, k * 100 * W * 4);
    const pos = Array.from({ length: 12 }, (_, i) => i * 60);
    const { out } = run(rep, pos);
    const want = truth(rep, pos.at(-1)!);
    expect(out.height).toBe(want.height);
    expect(maxRowError(out, want)).toBe(0);
  });

  it('nudges seams', () => {
    const st = new Stitcher();
    st.addFrame(frameAt(page, 0));
    st.addFrame(frameAt(page, 150));
    st.finish();
    const h = st.height;
    st.nudge(1, 10);
    expect(st.height).toBe(h + 10);
    expect(st.seams()[0]!.adjust).toBe(10);
    st.nudge(1, -10);
    expect(maxRowError(st.compose(), truth(page, 150))).toBe(0);
  });

  it('rejects frames of a different size', () => {
    const st = new Stitcher();
    st.addFrame(frameAt(page, 0));
    expect(() => st.addFrame({ width: 10, height: 10, data: new Uint8ClampedArray(400) })).toThrow(/size changed/);
  });

  it('caps the output height', () => {
    const st = new Stitcher({ maxHeight: 600 });
    const statuses = [0, 150, 300, 450, 600].map((p) => st.addFrame(frameAt(page, p)).status);
    expect(statuses).toContain('full');
    expect(st.compose().height).toBe(600);
  });
});
