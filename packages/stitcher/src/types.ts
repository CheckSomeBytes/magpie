/** RGBA pixels, row-major (same layout as ImageData). */
export interface Frame {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface StitchOptions {
  /** Rows two frames must share for an offset to count. */
  minOverlap: number;
  /** Rows match when their signatures differ by less than this (luma levels). */
  rowTolerance: number;
  /** Fraction of informative overlap rows that must match. */
  matchRatio: number;
  /** Keep a frame once it has scrolled this fraction of the content height. */
  keepFraction: number;
  /** Stop growing past this many output rows (Chromium canvas limit is 32767). */
  maxHeight: number;
  /** Rows sampled per offset when voting (performance bound). */
  sampleRows: number;
}

export const DEFAULT_OPTIONS: StitchOptions = {
  minOverlap: 24,
  rowTolerance: 2.5,
  matchRatio: 0.85,
  keepFraction: 0.4,
  maxHeight: 32000,
  sampleRows: 160,
};

export type AddStatus =
  /** First frame. */
  | 'first'
  /** Nothing moved. */
  | 'static'
  /** Moved, but not far enough to keep yet. */
  | 'pending'
  /** Appended. */
  | 'kept'
  /** Scrolled up: ignored (only downward scrolling is stitched). */
  | 'reverse'
  /** Lost track (scrolled too fast); appended at a guessed offset and flagged. */
  | 'gap'
  /** Reached maxHeight; frame ignored. */
  | 'full';

export interface AddResult {
  status: AddStatus;
  /** Offset of this frame vs. the last kept frame, when known. */
  offset: number | null;
  /** Current stitched height in rows. */
  height: number;
  kept: number;
}

export interface Seam {
  /** Index of the kept frame that starts at this seam (≥ 1). */
  index: number;
  /** Detected offset vs. previous kept frame. */
  detected: number;
  /** Manual adjustment from nudge(). */
  adjust: number;
  /** Output row where this frame takes over. */
  outputRow: number;
  /** 0..1 share of overlap rows that matched at the chosen offset. */
  confidence: number;
  gap: boolean;
}
