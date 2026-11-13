/**
 * OverlayManager (§4.3, §6): frozen-screenshot region selection.
 *
 * Linux/Wayland: we cannot position windows (A6). Open ONE fullscreen window,
 * let Mutter put it on the focused monitor, then work out which display it
 * landed on. The renderer shows a display picker as an escape hatch.
 *
 * Windows: one frameless always-on-top window per display, each with its own frame.
 */
import { BrowserWindow, screen, type WebContents } from 'electron';
import type { CaptureResult } from '../capture';
import { CH, type OverlayInit, type OverlaySelection, type WindowRect } from '../../shared/ipc';
import { createAppWindow } from './common';

interface OverlayWin {
  win: BrowserWindow;
  displayId: string | null;
}

interface Session {
  capture: CaptureResult;
  mode: 'region' | 'window';
  windows: WindowRect[];
  wins: Map<number, OverlayWin>;
  resolve: (sel: OverlaySelection | null) => void;
}

let session: Session | null = null;

export function isOverlayOpen(): boolean {
  return session !== null;
}

function labelFor(id: string, index: number): string {
  const d = screen.getAllDisplays().find((x) => String(x.id) === id);
  const name = d?.label?.trim();
  return name ? `${index + 1}: ${name}` : `Display ${index + 1}`;
}

export function openOverlay(capture: CaptureResult, mode: 'region' | 'window', windows: WindowRect[]): Promise<OverlaySelection | null> {
  if (session) return Promise.resolve(null);
  return new Promise((resolve) => {
    session = { capture, mode, windows, wins: new Map(), resolve };
    if (process.platform === 'linux') openLinux(session);
    else openPerDisplay(session);
  });
}

function openLinux(s: Session): void {
  const primary = String(screen.getPrimaryDisplay().id);
  const win = createAppWindow('overlay', {
    frame: false,
    fullscreen: true,
    skipTaskbar: true,
    alwaysOnTop: true,
    resizable: false,
    backgroundColor: '#000000',
    title: 'Magpie capture',
  });
  const entry: OverlayWin = { win, displayId: s.capture.displays.some((d) => d.id === primary) ? primary : s.capture.displays[0]?.id ?? null };
  s.wins.set(win.webContents.id, entry);

  const detect = () => {
    if (win.isDestroyed()) return;
    const d = screen.getDisplayMatching(win.getBounds());
    const id = String(d.id);
    if (id !== entry.displayId && s.capture.displays.some((x) => x.id === id)) {
      entry.displayId = id;
      win.webContents.send(CH.overlayDisplay, id);
    }
  };
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
    setTimeout(detect, 50);
  });
  win.on('resize', detect);
  win.on('move', detect);
  win.on('closed', () => cancelIfOwner(win));
}

function openPerDisplay(s: Session): void {
  for (const d of screen.getAllDisplays()) {
    const id = String(d.id);
    if (!s.capture.displays.some((x) => x.id === id)) continue;
    const win = createAppWindow('overlay', {
      ...d.bounds,
      frame: false,
      transparent: false,
      skipTaskbar: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      enableLargerThanScreen: true,
      hasShadow: false,
      backgroundColor: '#000000',
      title: 'Magpie capture',
    });
    win.setAlwaysOnTop(true, 'screen-saver');
    s.wins.set(win.webContents.id, { win, displayId: id });
    win.once('ready-to-show', () => {
      // Re-apply bounds after show: Windows can rescale across mixed-DPI monitors.
      win.setBounds(d.bounds);
      win.show();
      if (d.bounds.x === screen.getDisplayNearestPoint(screen.getCursorScreenPoint()).bounds.x) win.focus();
    });
    win.on('closed', () => cancelIfOwner(win));
  }
}

function cancelIfOwner(win: BrowserWindow): void {
  if (session && [...session.wins.values()].some((w) => w.win === win)) finish(null);
}

function finish(sel: OverlaySelection | null): void {
  const s = session;
  if (!s) return;
  session = null;
  for (const { win } of s.wins.values()) if (!win.isDestroyed()) win.destroy();
  s.resolve(sel);
}

export function overlayInitFor(sender: WebContents): OverlayInit {
  const s = session;
  const entry = s?.wins.get(sender.id);
  if (!s || !entry) throw new Error('No overlay session for this window');
  const displays = s.capture.displays.map((info, i) => ({ info, label: labelFor(info.id, i) }));
  return {
    frames: s.capture.frames.map((f) => f.png),
    frameIndex: s.capture.frameIndex,
    displays,
    displayId: entry.displayId,
    windows: s.windows,
    showDisplayPicker: process.platform === 'linux' && displays.length > 1,
    mode: s.mode,
  };
}

export function overlayCommit(sender: WebContents, sel: OverlaySelection): void {
  if (session?.wins.has(sender.id)) finish(sel);
}

export function overlayCancel(sender: WebContents): void {
  if (session?.wins.has(sender.id)) finish(null);
}
