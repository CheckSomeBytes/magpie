/**
 * Dev-only provider: MAGPIE_FAKE_CAPTURE=/path/to/desktop.png serves that PNG
 * as the whole desktop. Lets the overlay/editor flow run anywhere (CI, WSL,
 * a non-GNOME session) without touching the portal.
 */
import { nativeImage, screen } from 'electron';
import { readFile } from 'node:fs/promises';
import { mapDisplaysToDesktopImage } from '../../shared/geometry';
import type { CaptureProvider, CaptureResult } from './types';

export class FakeCapture implements CaptureProvider {
  readonly name = 'fake';
  constructor(private readonly file: string) {}

  async captureDesktop(): Promise<CaptureResult> {
    const png = await readFile(this.file);
    const { width, height } = nativeImage.createFromBuffer(png).getSize();
    const displays = screen.getAllDisplays().map((d) => ({ id: String(d.id), bounds: d.bounds, scaleFactor: d.scaleFactor }));
    const { maps } = mapDisplaysToDesktopImage(displays, width, height);
    return {
      frames: [{ png, widthPx: width, heightPx: height }],
      displays: maps,
      frameIndex: Object.fromEntries(maps.map((m) => [m.id, 0])),
      source: 'portal',
      capturedAt: new Date().toISOString(),
    };
  }

  captureDisplay(): Promise<CaptureResult> {
    return this.captureDesktop();
  }
}
