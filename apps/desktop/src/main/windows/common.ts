import { BrowserWindow, type BrowserWindowConstructorOptions } from 'electron';
import { join } from 'node:path';
import appIcon from '../../../resources/icons/icon.png?asset';

export type Page = 'overlay' | 'editor' | 'home' | 'library' | 'scroll' | 'ocr';

export function createAppWindow(page: Page, opts: BrowserWindowConstructorOptions): BrowserWindow {
  const win = new BrowserWindow({
    show: false,
    icon: appIcon,
    autoHideMenuBar: true,
    ...opts,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false,
      ...opts.webPreferences,
    },
  });

  // No navigation away from our own pages, no popups.
  win.webContents.on('will-navigate', (e) => e.preventDefault());
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));

  const devUrl = process.env['ELECTRON_RENDERER_URL'];
  if (devUrl) void win.loadURL(`${devUrl}/${page}/index.html`);
  else void win.loadFile(join(__dirname, `../renderer/${page}/index.html`));
  return win;
}

export { appIcon };
