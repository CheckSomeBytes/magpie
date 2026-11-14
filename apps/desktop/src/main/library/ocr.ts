/**
 * Background OCR for library search (Phase 4, §11). tesseract.js runs in a
 * hidden renderer (the browser build, fully offline via magpie-asset://);
 * main feeds it one capture at a time and stores the text in the index.
 */
import { BrowserWindow, ipcMain } from 'electron';
import { CH } from '../../shared/ipc';
import { settings } from '../settings';
import { loadProject } from '../store/project-store';
import { createAppWindow } from '../windows/common';
import { broadcastChanged, lib, libraryEvents } from './service';

const JOB_TIMEOUT_MS = 180_000;
const IDLE_CLOSE_MS = 60_000;

let win: BrowserWindow | null = null;
let ready: Promise<void> | null = null;
let markReady: (() => void) | null = null;
let running = false;
let idleTimer: NodeJS.Timeout | undefined;
const waiting = new Map<number, { resolve: (t: string) => void; reject: (e: Error) => void }>();

export function initOcr(): void {
  ipcMain.on(CH.ocrReady, (e) => {
    if (win && e.sender.id === win.webContents.id) markReady?.();
  });
  ipcMain.on(CH.ocrResult, (e, id: number, text: string | null, error?: string) => {
    if (!win || e.sender.id !== win.webContents.id) return;
    const w = waiting.get(id);
    if (!w) return;
    waiting.delete(id);
    if (text === null) w.reject(new Error(error || 'OCR failed'));
    else w.resolve(text);
  });
  libraryEvents.on('indexed', () => void kickOcr());
  settings.onChange((next, prev) => {
    if (next.ocrEnabled && !prev.ocrEnabled) void kickOcr();
  });
}

function ensureWindow(): Promise<void> {
  if (win && !win.isDestroyed() && ready) return ready;
  ready = new Promise<void>((r) => (markReady = r));
  win = createAppWindow('ocr', { show: false, width: 400, height: 300, webPreferences: { backgroundThrottling: false } });
  win.on('closed', () => {
    win = null;
    ready = null;
    for (const [, w] of waiting) w.reject(new Error('OCR window closed'));
    waiting.clear();
  });
  return ready;
}

function recognize(id: number, png: Uint8Array): Promise<string> {
  return new Promise((resolve, reject) => {
    const t = setTimeout(() => {
      waiting.delete(id);
      reject(new Error('OCR timed out'));
    }, JOB_TIMEOUT_MS);
    waiting.set(id, {
      resolve: (s) => (clearTimeout(t), resolve(s)),
      reject: (e) => (clearTimeout(t), reject(e)),
    });
    win!.webContents.send(CH.ocrJob, { id, png });
  });
}

export async function kickOcr(): Promise<void> {
  if (running || !settings.get().ocrEnabled) return;
  running = true;
  clearTimeout(idleTimer);
  let done = 0;
  try {
    for (;;) {
      if (!settings.get().ocrEnabled) break;
      const [job] = lib().needsOcr(1);
      if (!job) break;
      let text = '';
      try {
        await ensureWindow();
        const project = await loadProject(job.path);
        text = (await recognize(job.id, project.original)).replace(/\s+\n/g, '\n').trim();
      } catch (err) {
        // Store '' so a bad file never loops; a re-capture or rescan won't redo it either.
        console.warn('[ocr] failed for', job.path, (err as Error).message);
      }
      lib().setOcrText(job.id, text);
      done++;
      if (done % 3 === 0) broadcastChanged();
    }
  } finally {
    running = false;
    if (done) {
      broadcastChanged();
      console.log(`[ocr] read ${done} capture(s)`);
    }
    // Free the ~100 MB tesseract worker when there's nothing left to do.
    idleTimer = setTimeout(() => {
      if (!running && win && !win.isDestroyed()) win.destroy();
    }, IDLE_CLOSE_MS);
  }
}
