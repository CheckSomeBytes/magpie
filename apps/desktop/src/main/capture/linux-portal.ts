import { nativeImage, screen } from 'electron';
import { mapDisplaysToDesktopImage, type LogicalDisplay } from '../../shared/geometry';
import { portalScreenshot } from './portal-dbus';
import type { CaptureProvider, CaptureResult } from './types';

function logicalDisplays(): LogicalDisplay[] {
  return screen.getAllDisplays().map((d) => ({ id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor }));
}

function toResult(png: Buffer): CaptureResult {
  const { width, height } = nativeImage.createFromBuffer(png).getSize();
  const { maps, ratioX, ratioY } = mapDisplaysToDesktopImage(logicalDisplays(), width, height);
  if (Math.abs(ratioX - ratioY) > 0.01) {
    console.warn(`[capture] non-uniform desktop scale ${ratioX.toFixed(3)} × ${ratioY.toFixed(3)}; crops may be off (spike 3)`);
  }
  const frameIndex: Record<string, number> = {};
  for (const m of maps) frameIndex[m.id] = 0;
  return {
    frames: [{ png, widthPx: width, heightPx: height }],
    displays: maps,
    frameIndex,
    source: 'portal',
    capturedAt: new Date().toISOString(),
  };
}

/**
 * Ubuntu 26.04 / GNOME 50 / Wayland (§4).
 * Non-interactive grab of the whole desktop: one-time permission prompt, then silent (portal v2).
 */
export class LinuxPortalCapture implements CaptureProvider {
  readonly name = 'linux-portal';

  async captureDesktop(): Promise<CaptureResult> {
    const { png } = await portalScreenshot({ interactive: false });
    return toResult(png);
  }

  async captureDisplay(id?: string): Promise<CaptureResult> {
    // The portal always returns the whole desktop; narrow the display map instead of re-encoding.
    const all = await this.captureDesktop();
    // getCursorScreenPoint is unsupported on Wayland (A6), so "current" = primary.
    const want = id ?? String(screen.getPrimaryDisplay().id);
    const displays = all.displays.filter((d) => d.id === want);
    return displays.length ? { ...all, displays } : all;
  }

  async captureInteractive(): Promise<CaptureResult> {
    const { png } = await portalScreenshot({ interactive: true });
    // The user picked an area/window; it's not a desktop-shaped image, so give it a synthetic display.
    const { width, height } = nativeImage.createFromBuffer(png).getSize();
    return {
      frames: [{ png, widthPx: width, heightPx: height }],
      displays: [{ id: 'interactive', bounds: { x: 0, y: 0, width, height }, scaleFactor: 1, rectPx: { x: 0, y: 0, width, height } }],
      frameIndex: { interactive: 0 },
      source: 'portal',
      capturedAt: new Date().toISOString(),
    };
  }
}
