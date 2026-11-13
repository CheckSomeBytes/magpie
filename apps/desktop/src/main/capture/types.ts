import type { DisplayInfo } from '@magpie/format';
import type { WindowRect } from '../../shared/ipc';

/**
 * A capture is one or more PNG frames plus a map of where each display sits.
 *  - Linux portal: one frame = whole composited desktop, every display maps into it.
 *  - Windows desktopCapturer: one frame per display.
 */
export interface CaptureFrame {
  png: Buffer;
  widthPx: number;
  heightPx: number;
}

export interface CaptureResult {
  frames: CaptureFrame[];
  /** Per display: logical bounds, scaleFactor, and rectPx inside frames[frameIndex[id]]. */
  displays: DisplayInfo[];
  frameIndex: Record<string, number>;
  source: 'portal' | 'desktopCapturer';
  capturedAt: string;
}

export interface CaptureProvider {
  readonly name: string;
  /** All monitors. */
  captureDesktop(): Promise<CaptureResult>;
  /** One monitor; defaults to the one under the cursor (or primary where unknown). */
  captureDisplay(id?: string): Promise<CaptureResult>;
  /** Linux: GNOME's own picker (area/window/screen). Only way to get one window's pixels on Wayland. */
  captureInteractive?(): Promise<CaptureResult>;
  /** Windows: visible top-level windows, z-ordered, for overlay snapping. */
  listWindows?(): Promise<WindowRect[]>;
}

export class CaptureCancelled extends Error {
  override name = 'CaptureCancelled';
  constructor() {
    super('Capture cancelled');
  }
}
