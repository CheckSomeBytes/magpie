/**
 * Scrolling-capture session window (Phase 3). One window that changes shape:
 *   hidden (stream starting / portal dialog) → fullscreen region select on a
 *   frozen frame → small always-on-top recording panel → review.
 */
import { BrowserWindow, nativeImage, screen, type WebContents } from 'electron';
import { readFile } from 'node:fs/promises';
import { CH, type ScrollInit, type ScrollPhase } from '../../shared/ipc';
import { lastStreamDisplay } from '../capture/display-media';
import { settings } from '../settings';
import { createProjectFromCapture } from '../store/project-store';
import { createAppWindow } from './common';
import { openEditor } from './editor';

let win: BrowserWindow | null = null;
let phase: ScrollPhase | 'starting' = 'starting';

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Leaving fullscreen is asynchronous on Linux; resizing before it settles gets overridden. */
async function leaveFullScreen(w: BrowserWindow): Promise<void> {
  if (!w.isFullScreen()) return;
  await new Promise<void>((resolve) => {
    const t = setTimeout(resolve, 1500);
    w.once('leave-full-screen', () => {
      clearTimeout(t);
      resolve();
    });
    w.setFullScreen(false);
  });
  await delay(100);
}

export function isScrollSessionOpen(): boolean {
  return !!win && !win.isDestroyed();
}

/** The scroll hotkey while a session is open: finish recording (or focus the window). */
export function scrollHotkeyPressed(): void {
  if (!win || win.isDestroyed()) return;
  if (phase === 'recording') win.webContents.send(CH.scrollStop);
  else win.focus();
}

export function startScrollSession(): void {
  if (isScrollSessionOpen()) {
    scrollHotkeyPressed();
    return;
  }
  phase = 'starting';
  win = createAppWindow('scroll', {
    width: 420,
    height: 160,
    frame: false,
    resizable: false,
    skipTaskbar: false,
    title: 'Magpie scrolling capture',
    backgroundColor: '#1b1d22',
    // Sampling must keep running while the window is hidden or unfocused.
    webPreferences: { backgroundThrottling: false },
  });
  // Stays hidden while the stream starts (the portal shows its own dialog on Wayland).
  win.on('closed', () => {
    win = null;
  });
}

function sender(e: WebContents): BrowserWindow {
  if (!win || win.isDestroyed() || e.id !== win.webContents.id) throw new Error('Not the scroll window');
  return win;
}

export async function scrollInit(e: WebContents): Promise<ScrollInit> {
  sender(e);
  const fake = process.env['MAGPIE_FAKE_SCROLL'];
  return {
    fakeTall: fake ? new Uint8Array(await readFile(fake)) : null,
    stopHotkey: settings.get().hotkeys.scroll ?? '',
  };
}

export async function scrollPhase(e: WebContents, next: ScrollPhase): Promise<void> {
  const w = sender(e);
  phase = next;
  const target = lastStreamDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());

  if (next === 'select') {
    w.setResizable(true);
    if (process.platform === 'linux') {
      w.setFullScreen(true);
    } else {
      w.setBounds(target.bounds);
      w.setAlwaysOnTop(true, 'screen-saver');
    }
    w.show();
    w.focus();
    return;
  }

  if (next === 'recording') {
    // Get the fullscreen window out of the picture before sampling starts.
    // Leave fullscreen while still visible (a hidden window never finishes the transition).
    await leaveFullScreen(w);
    w.hide();
    await delay(150);
    w.setAlwaysOnTop(true, 'floating');
    // Windows: keep the panel out of the captured pixels entirely.
    if (process.platform === 'win32') w.setContentProtection(true);
    const size = { width: 420, height: 160 };
    const wa = target.workArea;
    w.setBounds({ x: wa.x + wa.width - size.width - 24, y: wa.y + wa.height - size.height - 24, ...size });
    w.setResizable(false);
    w.showInactive();
    await delay(250); // let the compositor drop the overlay from the stream
    return;
  }

  // review
  await leaveFullScreen(w);
  w.setContentProtection(false);
  w.setAlwaysOnTop(false);
  w.setResizable(true);
  const wa = screen.getPrimaryDisplay().workArea;
  const width = Math.min(1100, wa.width - 80);
  const height = Math.min(860, wa.height - 80);
  w.setBounds({ x: wa.x + Math.round((wa.width - width) / 2), y: wa.y + Math.round((wa.height - height) / 2), width, height });
  w.setMinimumSize(640, 420);
  w.show();
  w.focus();
}

export async function scrollFinish(e: WebContents, png: Uint8Array): Promise<void> {
  const w = sender(e);
  const buf = Buffer.from(png);
  const { width, height } = nativeImage.createFromBuffer(buf).getSize();
  if (!width || !height) throw new Error('The stitched image is empty.');
  const { path, project } = await createProjectFromCapture({
    png: buf,
    widthPx: width,
    heightPx: height,
    displays: [],
    source: 'desktopCapturer',
    capturedAt: new Date().toISOString(),
  });
  w.destroy();
  openEditor(path, project, null);
}

export function scrollCancel(e: WebContents): void {
  sender(e).destroy();
}
