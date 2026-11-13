/**
 * Logical (DIP) ↔ physical (image pixel) mapping. Pure functions, unit-tested.
 *
 * Linux (§4.4): the portal returns ONE PNG of the whole composited desktop.
 * GNOME renders the stage at a uniform scale, so rather than trusting each
 * display's scaleFactor we derive the ratio from image size ÷ logical
 * bounding box. Spike 3 must confirm this with fractional + mixed DPI.
 *
 * Windows (§6): one frame per display; ratio = frame size ÷ display bounds.
 */
import type { DisplayInfo, Rect } from '@magpie/format';

export interface LogicalDisplay {
  id: string;
  bounds: Rect;
  scaleFactor: number;
}

export function boundingBox(rects: Rect[]): Rect {
  if (rects.length === 0) return { x: 0, y: 0, width: 0, height: 0 };
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const right = Math.max(...rects.map((r) => r.x + r.width));
  const bottom = Math.max(...rects.map((r) => r.y + r.height));
  return { x, y, width: right - x, height: bottom - y };
}

/** Map every display into a single whole-desktop image (Linux portal frame). */
export function mapDisplaysToDesktopImage(
  displays: LogicalDisplay[],
  imageWidthPx: number,
  imageHeightPx: number,
): { maps: DisplayInfo[]; ratioX: number; ratioY: number } {
  const box = boundingBox(displays.map((d) => d.bounds));
  const ratioX = box.width ? imageWidthPx / box.width : 1;
  const ratioY = box.height ? imageHeightPx / box.height : 1;
  const maps = displays.map((d) => ({
    id: d.id,
    bounds: d.bounds,
    scaleFactor: d.scaleFactor,
    rectPx: clampRect(
      roundRect({
        x: (d.bounds.x - box.x) * ratioX,
        y: (d.bounds.y - box.y) * ratioY,
        width: d.bounds.width * ratioX,
        height: d.bounds.height * ratioY,
      }),
      imageWidthPx,
      imageHeightPx,
    ),
  }));
  return { maps, ratioX, ratioY };
}

/** A display that has a frame of its own (Windows). */
export function mapDisplayToOwnFrame(d: LogicalDisplay, frameWidthPx: number, frameHeightPx: number): DisplayInfo {
  return { id: d.id, bounds: d.bounds, scaleFactor: d.scaleFactor, rectPx: { x: 0, y: 0, width: frameWidthPx, height: frameHeightPx } };
}

/**
 * Convert a logical rect (relative to the display's top-left) into image pixels
 * within the frame that holds the display.
 */
export function logicalToFrameRect(display: DisplayInfo, rect: Rect): Rect {
  const sx = display.rectPx.width / display.bounds.width;
  const sy = display.rectPx.height / display.bounds.height;
  const r = roundRect({
    x: display.rectPx.x + rect.x * sx,
    y: display.rectPx.y + rect.y * sy,
    width: rect.width * sx,
    height: rect.height * sy,
  });
  // Keep the crop inside this display's slice of the frame.
  const slice = display.rectPx;
  const x = Math.max(slice.x, Math.min(r.x, slice.x + slice.width - 1));
  const y = Math.max(slice.y, Math.min(r.y, slice.y + slice.height - 1));
  const width = Math.max(1, Math.min(r.width, slice.x + slice.width - x));
  const height = Math.max(1, Math.min(r.height, slice.y + slice.height - y));
  return { x, y, width, height };
}

/** Normalize a drag (any direction) into a positive rect. */
export function rectFromPoints(x0: number, y0: number, x1: number, y1: number): Rect {
  return { x: Math.min(x0, x1), y: Math.min(y0, y1), width: Math.abs(x1 - x0), height: Math.abs(y1 - y0) };
}

export function intersect(a: Rect, b: Rect): Rect | null {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const r = Math.min(a.x + a.width, b.x + b.width);
  const btm = Math.min(a.y + a.height, b.y + b.height);
  if (r <= x || btm <= y) return null;
  return { x, y, width: r - x, height: btm - y };
}

export function containsPoint(r: Rect, x: number, y: number): boolean {
  return x >= r.x && y >= r.y && x < r.x + r.width && y < r.y + r.height;
}

function roundRect(r: Rect): Rect {
  const x = Math.round(r.x);
  const y = Math.round(r.y);
  return { x, y, width: Math.round(r.x + r.width) - x, height: Math.round(r.y + r.height) - y };
}

function clampRect(r: Rect, w: number, h: number): Rect {
  const x = Math.max(0, Math.min(r.x, w));
  const y = Math.max(0, Math.min(r.y, h));
  return { x, y, width: Math.max(0, Math.min(r.width, w - x)), height: Math.max(0, Math.min(r.height, h - y)) };
}
