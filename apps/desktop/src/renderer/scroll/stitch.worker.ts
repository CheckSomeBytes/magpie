/**
 * Stitching runs off the UI thread (§10): frames arrive as ImageBitmaps of
 * the selected region; the composed result goes back as a PNG Blob.
 */
import { Stitcher, type AddStatus, type Seam } from '@magpie/stitcher';

export type ToWorker =
  | { t: 'frame'; bitmap: ImageBitmap }
  | { t: 'finish' }
  | { t: 'nudge'; index: number; delta: number }
  | { t: 'reset' };

export type FromWorker =
  | { t: 'status'; status: AddStatus; height: number; kept: number; ms: number }
  | { t: 'composed'; png: Blob; width: number; height: number; seams: Seam[] }
  | { t: 'error'; message: string };

// Typed locally: the webworker lib can't coexist with the DOM lib in one TS project.
const ctx = self as unknown as {
  postMessage(m: FromWorker): void;
  onmessage: ((e: MessageEvent<ToWorker>) => void) | null;
};
let stitcher = new Stitcher();
let canvas: OffscreenCanvas | null = null;

function pixels(bitmap: ImageBitmap) {
  if (!canvas || canvas.width !== bitmap.width || canvas.height !== bitmap.height) {
    canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
  }
  const c = canvas.getContext('2d', { willReadFrequently: true })!;
  c.drawImage(bitmap, 0, 0);
  bitmap.close();
  const img = c.getImageData(0, 0, canvas.width, canvas.height);
  return { width: img.width, height: img.height, data: img.data };
}

async function compose(): Promise<void> {
  const out = stitcher.compose();
  const oc = new OffscreenCanvas(Math.max(1, out.width), Math.max(1, out.height));
  oc.getContext('2d')!.putImageData(new ImageData(out.data as Uint8ClampedArray<ArrayBuffer>, out.width, out.height), 0, 0);
  const png = await oc.convertToBlob({ type: 'image/png' });
  post({ t: 'composed', png, width: out.width, height: out.height, seams: stitcher.seams() });
}

function post(m: FromWorker): void {
  ctx.postMessage(m);
}

ctx.onmessage = async (e: MessageEvent<ToWorker>) => {
  const m = e.data;
  try {
    switch (m.t) {
      case 'frame': {
        const t0 = performance.now();
        const r = stitcher.addFrame(pixels(m.bitmap));
        post({ t: 'status', status: r.status, height: r.height, kept: r.kept, ms: Math.round(performance.now() - t0) });
        break;
      }
      case 'finish':
        stitcher.finish();
        await compose();
        break;
      case 'nudge':
        stitcher.nudge(m.index, m.delta);
        await compose();
        break;
      case 'reset':
        stitcher = new Stitcher();
        break;
    }
  } catch (err) {
    post({ t: 'error', message: (err as Error).message });
  }
};
