/**
 * Per-row signatures. Screen-capture streams are often converted to I420
 * video frames, so exact pixel hashes don't survive; luma does (to ±1–2).
 * Each row is summarized as BLOCKS column-blocks × (mean luma, mean
 * horizontal gradient), which captures text texture as well as tone.
 */
import type { Frame } from './types';

export const BLOCKS = 48;
export const SIG = BLOCKS * 2;

export interface Signatures {
  width: number;
  height: number;
  /** height × SIG floats. */
  sig: Float32Array;
  /** Rows with real detail (not flat background). Flat rows match anything, so they never vote. */
  informative: Uint8Array;
}

export function computeSignatures(f: Frame): Signatures {
  const { width: w, height: h, data } = f;
  const sig = new Float32Array(h * SIG);
  const informative = new Uint8Array(h);
  const blockW = w / BLOCKS;
  const lumaRow = new Float32Array(w);

  for (let y = 0; y < h; y++) {
    const rowOff = y * w * 4;
    for (let x = 0; x < w; x++) {
      const i = rowOff + x * 4;
      lumaRow[x] = 0.299 * data[i]! + 0.587 * data[i + 1]! + 0.114 * data[i + 2]!;
    }
    const base = y * SIG;
    let lo = Infinity;
    let hi = -Infinity;
    let gradSum = 0;
    for (let b = 0; b < BLOCKS; b++) {
      const x0 = Math.floor(b * blockW);
      const x1 = Math.max(x0 + 1, Math.floor((b + 1) * blockW));
      let sum = 0;
      let grad = 0;
      for (let x = x0; x < x1; x++) {
        const v = lumaRow[x]!;
        sum += v;
        if (x > 0) grad += Math.abs(v - lumaRow[x - 1]!);
      }
      const n = x1 - x0;
      const mean = sum / n;
      const g = grad / n;
      sig[base + b] = mean;
      sig[base + BLOCKS + b] = g;
      if (mean < lo) lo = mean;
      if (mean > hi) hi = mean;
      gradSum += g;
    }
    informative[y] = hi - lo > 3 || gradSum / BLOCKS > 1.5 ? 1 : 0;
  }
  return { width: w, height: h, sig, informative };
}

/** Mean absolute difference between row ya of A and row yb of B. */
export function rowDiff(a: Signatures, ya: number, b: Signatures, yb: number): number {
  const oa = ya * SIG;
  const ob = yb * SIG;
  let s = 0;
  for (let k = 0; k < SIG; k++) s += Math.abs(a.sig[oa + k]! - b.sig[ob + k]!);
  return s / SIG;
}
