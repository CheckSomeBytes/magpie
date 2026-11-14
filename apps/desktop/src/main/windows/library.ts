import type { BrowserWindow } from 'electron';
import { createAppWindow } from './common';

let win: BrowserWindow | null = null;

export function showLibrary(): BrowserWindow {
  if (win && !win.isDestroyed()) {
    win.show();
    win.focus();
    return win;
  }
  win = createAppWindow('library', {
    width: 1180,
    height: 780,
    minWidth: 720,
    minHeight: 480,
    title: 'Magpie Library',
    backgroundColor: '#1b1d22',
  });
  win.once('ready-to-show', () => win?.show());
  win.on('closed', () => (win = null));
  return win;
}
