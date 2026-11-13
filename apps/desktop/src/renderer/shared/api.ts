import type { MagpieApi } from '../../shared/ipc';

declare global {
  interface Window {
    magpie: MagpieApi;
  }
}

export const api: MagpieApi = window.magpie;

/** Bytes → object URL. The URL is same-origin, so canvases drawn from it stay untainted. */
export function pngUrl(bytes: Uint8Array): string {
  return URL.createObjectURL(new Blob([bytes as BlobPart], { type: 'image/png' }));
}

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Could not decode image'));
    img.src = src;
  });
}

export async function dataUrlToBytes(dataUrl: string): Promise<Uint8Array> {
  const res = await fetch(dataUrl);
  return new Uint8Array(await res.arrayBuffer());
}
