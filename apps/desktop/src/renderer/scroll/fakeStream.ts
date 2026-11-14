/**
 * Dev-only (MAGPIE_FAKE_SCROLL): turn a tall PNG into a "screen" stream that
 * scrolls at an uneven speed once start() is called. Exercises the real
 * pipeline: video track → ImageBitmap → worker → stitcher.
 */
import { loadImage, pngUrl } from '../shared/api';

export interface FakeScroll {
  stream: MediaStream;
  start(): void;
  readonly done: boolean;
}

export async function fakeScrollStream(png: Uint8Array): Promise<FakeScroll> {
  const img = await loadImage(pngUrl(png));
  const vh = Math.min(img.naturalHeight, 520);
  const c = document.createElement('canvas');
  c.width = img.naturalWidth;
  c.height = vh;
  const g = c.getContext('2d')!;
  const max = img.naturalHeight - vh;
  let y = 0;
  let scrolling = false;
  let tick = 0;
  const draw = () => g.drawImage(img, 0, y, c.width, vh, 0, 0, c.width, vh);
  draw();
  const stream = c.captureStream(30);

  setInterval(() => {
    draw(); // keep frames flowing even while paused
    if (!scrolling || y >= max) return;
    tick++;
    if (tick % 9 === 0) return; // occasional pause
    y = Math.min(max, y + 12 + ((tick * 37) % 41)); // uneven speed, 12–52 px per tick
  }, 110);

  return {
    stream,
    start: () => (scrolling = true),
    get done() {
      return y >= max;
    },
  };
}
