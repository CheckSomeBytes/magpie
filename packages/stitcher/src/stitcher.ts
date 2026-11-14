/**
 * Scrolling-capture stitcher (§10). The user scrolls; we sample frames of a
 * fixed region and append only what's new.
 *
 *  - Offsets by row voting over tolerant row signatures (robust to video
 *    colour conversion), restricted to informative rows (flat background
 *    rows match everywhere, so they never vote).
 *  - Fixed header/footer: rows that stay put while content moves. Estimated
 *    as the minimum seen across moving pairs, and masked out of matching.
 *  - Repetitive content (tables, identical cards) makes several offsets
 *    score alike; we prefer the one closest to the recent scroll speed.
 *  - Seams go at the most similar row in the overlap, nearest its middle.
 *  - Bounded memory: a frame is kept only once it has scrolled ≥ keepFraction
 *    of the content height, with the latest "pending" frame held as a
 *    fallback for when the user scrolls too fast.
 */
import { computeSignatures, rowDiff, type Signatures } from './signature';
import { DEFAULT_OPTIONS, type AddResult, type Frame, type Seam, type StitchOptions } from './types';

interface Kept {
  frame: Frame;
  sig: Signatures;
  /** Offset vs. previous kept frame (0 for the first). */
  detected: number;
  adjust: number;
  confidence: number;
  gap: boolean;
}

interface Match {
  offset: number;
  confidence: number;
}

export class Stitcher {
  readonly opts: StitchOptions;
  private kept: Kept[] = [];
  private pending: { frame: Frame; sig: Signatures; match: Match } | null = null;
  private header = -1; // -1 = unknown yet
  private footer = -1;
  /** Last per-sample scroll step (for disambiguating repetitive content). */
  private lastStep = 0;
  /** Last offset between kept frames (for guessing gaps). */
  private lastKeptStep = 0;
  private width = 0;
  private frameHeight = 0;

  constructor(opts: Partial<StitchOptions> = {}) {
    this.opts = { ...DEFAULT_OPTIONS, ...opts };
  }

  get frames(): number {
    return this.kept.length;
  }

  /** Stitched height so far, counting the pending frame (it's kept on finish()). */
  get height(): number {
    if (!this.kept.length) return 0;
    const pending = this.pending?.match.offset ?? 0;
    return Math.min(this.opts.maxHeight, this.positions().at(-1)! + pending + this.frameHeight);
  }

  get fixedHeader(): number {
    return Math.max(0, this.header);
  }

  get fixedFooter(): number {
    return Math.max(0, this.footer);
  }

  addFrame(frame: Frame): AddResult {
    if (!this.kept.length) {
      this.width = frame.width;
      this.frameHeight = frame.height;
      this.kept.push({ frame, sig: computeSignatures(frame), detected: 0, adjust: 0, confidence: 1, gap: false });
      return this.result('first', 0);
    }
    if (frame.width !== this.width || frame.height !== this.frameHeight) {
      throw new Error(`Frame size changed (${frame.width}×${frame.height}, expected ${this.width}×${this.frameHeight}).`);
    }
    if (this.height >= this.opts.maxHeight) return this.result('full', null);

    const sig = computeSignatures(frame);
    // Compare with the most recent sample (pending or kept), not the last kept frame:
    // consecutive samples move little, so repetitive content can't alias.
    const last = this.kept.at(-1)!;
    const ref = this.pending ?? { frame: last.frame, sig: last.sig, match: { offset: 0, confidence: 1 } };
    this.learnFixedRows(ref.sig, sig);

    if (this.isStatic(ref.sig, sig)) return this.result('static', 0);

    const step = this.findOffset(ref.sig, sig);
    if (step) {
      this.lastStep = step.offset;
      const total = ref.match.offset + step.offset;
      const confidence = Math.min(ref.match.confidence, step.confidence);
      if (total <= this.contentHeight() - this.opts.minOverlap) return this.accept(frame, sig, { offset: total, confidence });
      // Too far from the last kept frame to overlap it: keep the pending frame, chain from there.
      if (this.pending) {
        this.keepPending();
        return this.accept(frame, sig, step);
      }
      return this.accept(frame, sig, step);
    }

    // Scrolled up? (B above the reference.) Ignore rather than flagging a gap.
    if (this.findOffset(sig, ref.sig)) return this.result('reverse', null);

    // Lost track (scrolled too fast): keep what we have, append at a guessed offset, flag it.
    if (this.pending) this.keepPending();
    const content = this.contentHeight();
    const guess = Math.max(1, Math.min(content - this.opts.minOverlap, this.lastKeptStep || Math.round(content * 0.75)));
    this.keep(frame, sig, { offset: guess, confidence: 0 }, true);
    return this.result('gap', guess);
  }

  private keepPending(): void {
    const p = this.pending;
    if (!p) return;
    this.pending = null;
    this.keep(p.frame, p.sig, p.match, false);
  }

  /** Call when recording stops so the last bit of scrolling isn't lost. */
  finish(): void {
    this.keepPending();
  }

  seams(): Seam[] {
    const pos = this.positions();
    return this.kept.slice(1).map((k, i) => {
      const index = i + 1;
      return {
        index,
        detected: k.detected,
        adjust: k.adjust,
        outputRow: pos[index]! + this.seamRow(index),
        confidence: k.confidence,
        gap: k.gap,
      };
    });
  }

  /** Shift frame `index` (≥1) by `delta` rows relative to its predecessor. */
  nudge(index: number, delta: number): void {
    const k = this.kept[index];
    if (!k || index === 0) return;
    const content = this.contentHeight();
    const eff = k.detected + k.adjust + delta;
    if (eff < 1 || eff > content) return;
    k.adjust += delta;
  }

  /** Render the stitched image. */
  compose(): Frame {
    const n = this.kept.length;
    if (!n) return { width: 0, height: 0, data: new Uint8ClampedArray() };
    const W = this.width;
    const H = this.frameHeight;
    const top = this.fixedHeader;
    const bottom = this.fixedFooter;
    const pos = this.positions();
    const total = Math.min(this.opts.maxHeight, pos[n - 1]! + H);
    const out = new Uint8ClampedArray(W * total * 4);
    const rowBytes = W * 4;
    const copyRows = (src: Frame, srcY: number, dstY: number, count: number) => {
      const c = Math.min(count, total - dstY, src.height - srcY);
      if (c <= 0) return;
      out.set(src.data.subarray(srcY * rowBytes, (srcY + c) * rowBytes), dstY * rowBytes);
    };

    // Header from the first frame.
    copyRows(this.kept[0]!.frame, 0, 0, top);
    // Content: frame i owns output rows [start_i, start_{i+1}).
    const starts = this.kept.map((_, i) => (i === 0 ? top : pos[i]! + this.seamRow(i)));
    for (let i = 0; i < n; i++) {
      const start = starts[i]!;
      const end = i + 1 < n ? starts[i + 1]! : pos[i]! + H - bottom;
      if (end > start) copyRows(this.kept[i]!.frame, start - pos[i]!, start, end - start);
    }
    // Footer from the last frame.
    copyRows(this.kept[n - 1]!.frame, H - bottom, pos[n - 1]! + H - bottom, bottom);
    return { width: W, height: total, data: out };
  }

  // ---- internals ----------------------------------------------------------

  private result(status: AddResult['status'], offset: number | null): AddResult {
    return { status, offset, height: this.height, kept: this.kept.length };
  }

  private positions(): number[] {
    const pos: number[] = [];
    let p = 0;
    this.kept.forEach((k, i) => {
      if (i > 0) p += k.detected + k.adjust;
      pos.push(p);
    });
    return pos;
  }

  private contentHeight(): number {
    return this.frameHeight - this.fixedHeader - this.fixedFooter;
  }

  private accept(frame: Frame, sig: Signatures, match: Match): AddResult {
    const threshold = Math.max(1, Math.round(this.contentHeight() * this.opts.keepFraction));
    if (match.offset >= threshold) {
      this.keep(frame, sig, match, false);
      return this.result('kept', match.offset);
    }
    this.pending = { frame, sig, match };
    return this.result('pending', match.offset);
  }

  private keep(frame: Frame, sig: Signatures, match: Match, gap: boolean): void {
    this.kept.push({ frame, sig, detected: match.offset, adjust: 0, confidence: match.confidence, gap });
    this.lastKeptStep = match.offset;
    this.pending = null;
  }

  private rowsSame(a: Signatures, ya: number, b: Signatures, yb: number): boolean {
    return rowDiff(a, ya, b, yb) < this.opts.rowTolerance;
  }

  private isStatic(a: Signatures, b: Signatures): boolean {
    let diff = 0;
    let informative = 0;
    for (let y = 0; y < b.height; y++) {
      if (!b.informative[y] && !a.informative[y]) continue;
      informative++;
      if (!this.rowsSame(a, y, b, y)) diff++;
    }
    return informative === 0 || diff / informative < 0.02;
  }

  /**
   * Header/footer = rows identical at the same position while the content between them moved.
   * Only shrinks over time (min across pairs), so whitespace that merely looks fixed in one
   * pair can't stick.
   */
  private learnFixedRows(a: Signatures, b: Signatures): void {
    const h = b.height;
    let top = 0;
    while (top < h && this.rowsSame(a, top, b, top)) top++;
    let bottom = 0;
    while (bottom < h - top && this.rowsSame(a, h - 1 - bottom, b, h - 1 - bottom)) bottom++;
    if (top + bottom >= h * 0.9) return; // nothing moved (or nearly): no information
    // Cap so a tall static area can't swallow the content region.
    const cap = Math.floor(h * 0.35);
    top = Math.min(top, cap);
    bottom = Math.min(bottom, cap);
    this.header = this.header < 0 ? top : Math.min(this.header, top);
    this.footer = this.footer < 0 ? bottom : Math.min(this.footer, bottom);
  }

  /**
   * Find d > 0 such that row y of B equals row y+d of A (content moved up by d).
   * Returns null if no offset has enough agreeing informative rows.
   */
  private findOffset(a: Signatures, b: Signatures): Match | null {
    const top = this.fixedHeader;
    const bottom = this.fixedFooter;
    const H = b.height;
    const contentEnd = H - bottom;
    const maxD = contentEnd - top - this.opts.minOverlap;
    if (maxD < 1) return null;

    // Informative B rows inside the content band, sampled evenly for speed.
    const rows: number[] = [];
    for (let y = top; y < contentEnd; y++) if (b.informative[y]) rows.push(y);
    if (rows.length < 4) return null;
    const step = Math.max(1, Math.floor(rows.length / this.opts.sampleRows));
    const sample = rows.filter((_, i) => i % step === 0);

    const scores: Array<{ d: number; votes: number; considered: number }> = [];
    for (let d = 1; d <= maxD; d++) {
      let votes = 0;
      let considered = 0;
      for (const y of sample) {
        const ya = y + d;
        if (ya >= contentEnd) break; // sample is sorted
        considered++;
        if (this.rowsSame(a, ya, b, y)) votes++;
      }
      if (considered >= 4) scores.push({ d, votes, considered });
    }
    if (!scores.length) return null;

    const good = scores.filter((s) => s.votes / s.considered >= this.opts.matchRatio && s.considered >= Math.min(8, sample.length));
    if (!good.length) return null;
    const bestRatio = Math.max(...good.map((s) => s.votes / s.considered));
    // Candidates within 3% of the best ratio: ambiguous on repetitive content.
    const near = good.filter((s) => s.votes / s.considered >= bestRatio - 0.03);
    let pick = near[0]!;
    if (near.length > 1) {
      if (this.lastStep > 0) {
        pick = near.reduce((p, s) => (Math.abs(s.d - this.lastStep) < Math.abs(p.d - this.lastStep) ? s : p));
      } else {
        // No history: prefer the most overlap (smallest offset), then the most votes.
        pick = near.reduce((p, s) => (s.votes > p.votes || (s.votes === p.votes && s.d < p.d) ? s : p));
      }
    }
    return { offset: pick.d, confidence: pick.votes / pick.considered };
  }

  /** Seam for kept[i], as a row in kept[i]'s own coordinates. */
  private seamRow(i: number): number {
    const k = this.kept[i]!;
    const prev = this.kept[i - 1]!;
    const d = k.detected + k.adjust;
    const top = this.fixedHeader;
    const end = this.frameHeight - this.fixedFooter - d; // B rows [top, end) overlap A rows [top+d, end+d)
    if (end - top <= 2) return Math.max(top, Math.min(end, this.frameHeight - this.fixedFooter));
    const mid = (top + end) / 2;
    const margin = Math.floor((end - top) * 0.15);
    let best = Math.round(mid);
    let bestScore = Infinity;
    for (let y = top + margin; y < end - margin; y++) {
      // Most similar row; small bias toward the middle breaks ties.
      const score = rowDiff(prev.sig, y + d, k.sig, y) + Math.abs(y - mid) * 1e-4;
      if (score < bestScore) {
        bestScore = score;
        best = y;
      }
    }
    return best;
  }
}
