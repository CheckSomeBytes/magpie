/**
 * Offline OCR with tesseract.js (§11): browser build, worker + LSTM cores +
 * English data all served from magpie-asset://ocr (no network, no CDN).
 */
import { createWorker, OEM, type Worker } from 'tesseract.js';

let worker: Promise<Worker> | null = null;

function getWorker(): Promise<Worker> {
  worker ??= createWorker('eng', OEM.LSTM_ONLY, {
    workerPath: 'magpie-asset://ocr/worker.min.js',
    corePath: 'magpie-asset://ocr/core/',
    langPath: 'magpie-asset://ocr/lang',
    gzip: true,
    cacheMethod: 'none', // the language file is local; skip IndexedDB
  }).catch((err: unknown) => {
    worker = null;
    throw err;
  });
  return worker;
}

/** Recognize text in an image (PNG bytes, Blob or canvas). */
export async function recognizeText(image: Blob | HTMLCanvasElement | Uint8Array): Promise<string> {
  const w = await getWorker();
  const input = image instanceof Uint8Array ? new Blob([image as BlobPart], { type: 'image/png' }) : image;
  const { data } = await w.recognize(input);
  return data.text.replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim();
}

export async function terminateOcr(): Promise<void> {
  const w = worker;
  worker = null;
  if (w) await (await w).terminate();
}
