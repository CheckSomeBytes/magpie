import { app, nativeImage } from 'electron';
import type { Rect } from '@magpie/format';
import { logicalToFrameRect } from '../../shared/geometry';
import { FakeCapture } from './fake';
import { LinuxPortalCapture } from './linux-portal';
import type { CaptureProvider, CaptureResult } from './types';
import { WindowsCapture } from './windows';

export * from './types';

let provider: CaptureProvider | null = null;

export function getCaptureProvider(): CaptureProvider {
  if (provider) return provider;
  const fake = process.env['MAGPIE_FAKE_CAPTURE'];
  if (fake && !app.isPackaged) provider = new FakeCapture(fake);
  else if (process.platform === 'linux') provider = new LinuxPortalCapture();
  else if (process.platform === 'win32') provider = new WindowsCapture();
  else throw new Error(`Magpie does not support ${process.platform} yet.`);
  return provider;
}

/** Crop a logical rect (relative to a display) out of a capture → PNG at native resolution. */
export function cropCapture(capture: CaptureResult, displayId: string, rect: Rect): { png: Buffer; rectPx: Rect } {
  const display = capture.displays.find((d) => d.id === displayId);
  const fi = capture.frameIndex[displayId];
  if (!display || fi === undefined) throw new Error(`Display ${displayId} is not in this capture`);
  const frame = capture.frames[fi]!;
  const rectPx = logicalToFrameRect(display, rect);
  if (rectPx.x === 0 && rectPx.y === 0 && rectPx.width === frame.widthPx && rectPx.height === frame.heightPx) {
    return { png: frame.png, rectPx };
  }
  const img = nativeImage.createFromBuffer(frame.png).crop(rectPx);
  return { png: img.toPNG(), rectPx };
}

/** One display's full slice (logical rect = whole display). */
export function displaySlice(capture: CaptureResult, displayId: string): { png: Buffer; rectPx: Rect } {
  const d = capture.displays.find((x) => x.id === displayId);
  if (!d) throw new Error(`Display ${displayId} is not in this capture`);
  return cropCapture(capture, displayId, { x: 0, y: 0, width: d.bounds.width, height: d.bounds.height });
}
