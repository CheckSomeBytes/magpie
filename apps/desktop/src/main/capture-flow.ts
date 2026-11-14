/**
 * Hotkey/tray/CLI → capture → (overlay) → autosaved .magpie → editor.
 */
import { dialog, nativeImage, Notification } from 'electron';
import type { AnnotationType } from '@magpie/format';
import type { CaptureMode } from '../shared/ipc';
import { CaptureCancelled, cropCapture, displaySlice, getCaptureProvider, type CaptureResult } from './capture';
import { copyPng } from './clipboard';
import { settings } from './settings';
import { autosaveRoot, createProjectFromCapture, loadProject } from './store/project-store';
import { openEditor } from './windows/editor';
import { hideHomeForCapture } from './windows/home';
import { isOverlayOpen, openOverlay } from './windows/overlay';
import { startScrollSession } from './windows/scroll';

let busy = false;

export function notify(title: string, body: string): void {
  if (Notification.isSupported()) new Notification({ title, body }).show();
  else dialog.showErrorBox(title, body);
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

export async function runCapture(mode: CaptureMode): Promise<void> {
  if (mode === 'scroll') {
    // Its own session window; pressing the hotkey again finishes recording.
    hideHomeForCapture();
    startScrollSession();
    return;
  }
  if (busy || isOverlayOpen()) return;
  busy = true;
  const t0 = performance.now();
  try {
    if (hideHomeForCapture()) await delay(250); // let the compositor repaint without it
    const provider = getCaptureProvider();

    if (mode === 'full') {
      const c = process.platform === 'linux' ? await provider.captureDesktop() : await provider.captureDisplay();
      await finish(c, wholeFrame(c), null);
      return;
    }

    if (mode === 'window' && provider.captureInteractive) {
      // Wayland: the compositor's own picker is the only way to get one window (§4.2).
      const c = await provider.captureInteractive();
      await finish(c, wholeFrame(c), null);
      return;
    }

    if (mode === 'region' && process.platform === 'linux' && settings.get().linuxRegionMode === 'editor-crop') {
      const c = await provider.captureDesktop();
      await finish(c, wholeFrame(c), 'crop');
      return;
    }

    // Overlay path: region (both OSes) or window (Windows, with snapping).
    const [c, windows] = await Promise.all([provider.captureDesktop(), provider.listWindows?.() ?? Promise.resolve([])]);
    console.log(`[capture] grabbed in ${Math.round(performance.now() - t0)} ms`);
    const sel = await openOverlay(c, mode === 'window' ? 'window' : 'region', windows);
    if (!sel) return;
    if (sel.kind === 'display') await finish(c, displaySlice(c, sel.displayId).png, 'crop');
    else await finish(c, cropCapture(c, sel.displayId, sel.rect).png, null);
  } catch (err) {
    if (err instanceof CaptureCancelled) return;
    console.error('[capture] failed', err);
    notify('Capture failed', (err as Error).message);
  } finally {
    busy = false;
    console.log(`[capture] ${mode} done in ${Math.round(performance.now() - t0)} ms`);
  }
}

function wholeFrame(c: CaptureResult): Buffer {
  return c.frames[0]!.png;
}

async function finish(c: CaptureResult, png: Buffer, startTool: AnnotationType | 'crop' | null): Promise<void> {
  const { width, height } = nativeImage.createFromBuffer(png).getSize();
  if (settings.get().copyOnCapture) await copyPng(png);
  const { path, project } = await createProjectFromCapture({
    png,
    widthPx: width,
    heightPx: height,
    displays: c.displays,
    source: c.source,
    capturedAt: c.capturedAt,
  });
  openEditor(path, project, startTool);
}

export async function openProjectFile(path: string): Promise<void> {
  try {
    openEditor(path, await loadProject(path));
  } catch (err) {
    notify('Could not open file', `${path}\n${(err as Error).message}`);
  }
}

export async function openProjectDialog(): Promise<void> {
  const res = await dialog.showOpenDialog({
    title: 'Open Magpie project',
    defaultPath: autosaveRoot(),
    filters: [{ name: 'Magpie project', extensions: ['magpie'] }],
    properties: ['openFile', 'multiSelections'],
  });
  for (const p of res.filePaths) await openProjectFile(p);
}
