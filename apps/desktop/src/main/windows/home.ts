import type { BrowserWindow } from 'electron';
import { createAppWindow } from './common';

let home: BrowserWindow | null = null;

/** Home = capture buttons + settings + diagnostics. Single instance. */
export function showHome(): BrowserWindow {
  if (home && !home.isDestroyed()) {
    home.show();
    home.focus();
    return home;
  }
  home = createAppWindow('home', {
    width: 560,
    height: 720,
    minWidth: 480,
    minHeight: 520,
    title: 'Magpie',
    backgroundColor: '#1b1d22',
  });
  home.once('ready-to-show', () => home?.show());
  home.on('closed', () => (home = null));
  return home;
}

/** Hide home before a capture so it isn't in the shot. Returns true if it was visible. */
export function hideHomeForCapture(): boolean {
  if (home && !home.isDestroyed() && home.isVisible()) {
    home.hide();
    return true;
  }
  return false;
}
