import { desktopCapturer, screen, type Display } from 'electron';
import type { WindowRect } from '../../shared/ipc';
import { mapDisplayToOwnFrame } from '../../shared/geometry';
import type { CaptureFrame, CaptureProvider, CaptureResult } from './types';
import { listTopLevelWindows } from './win32';

/**
 * Windows 11 (§6): desktopCapturer thumbnails are real full-res screenshots,
 * no border, no prompt. One frame per display.
 */
export class WindowsCapture implements CaptureProvider {
  readonly name = 'windows-desktopCapturer';

  async captureDesktop(): Promise<CaptureResult> {
    return this.capture(screen.getAllDisplays());
  }

  async captureDisplay(id?: string): Promise<CaptureResult> {
    const all = screen.getAllDisplays();
    const target = id
      ? all.find((d) => String(d.id) === id)
      : screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
    return this.capture([target ?? screen.getPrimaryDisplay()]);
  }

  async listWindows(): Promise<WindowRect[]> {
    try {
      return listTopLevelWindows().map((w) => ({
        title: w.title,
        bounds: screen.screenToDipRect(null, w.rect),
      }));
    } catch (err) {
      console.warn('[capture] window enumeration failed; snapping disabled', err);
      return [];
    }
  }

  private async capture(displays: Display[]): Promise<CaptureResult> {
    const maxW = Math.max(...displays.map((d) => Math.round(d.size.width * d.scaleFactor)));
    const maxH = Math.max(...displays.map((d) => Math.round(d.size.height * d.scaleFactor)));
    const sources = await desktopCapturer.getSources({ types: ['screen'], thumbnailSize: { width: maxW, height: maxH } });
    const all = screen.getAllDisplays();

    const frames: CaptureFrame[] = [];
    const frameIndex: Record<string, number> = {};
    const infos = displays.map((d) => {
      const source =
        sources.find((s) => s.display_id === String(d.id)) ??
        // Fallback: match by enumeration order when display_id is empty (seen on some drivers).
        sources[all.findIndex((a) => a.id === d.id)];
      if (!source) throw new Error(`No capture source for display ${d.id}`);
      const img = source.thumbnail;
      // The returned size isn't guaranteed to match the request; read the actual size.
      const { width, height } = img.getSize();
      frameIndex[String(d.id)] = frames.length;
      frames.push({ png: img.toPNG(), widthPx: width, heightPx: height });
      return mapDisplayToOwnFrame({ id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor }, width, height);
    });

    return { frames, displays: infos, frameIndex, source: 'desktopCapturer', capturedAt: new Date().toISOString() };
  }
}
