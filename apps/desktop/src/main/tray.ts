import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { mkdir } from 'node:fs/promises';
import trayIconPath from '../../resources/icons/tray.png?asset';
import { openProjectDialog, runCapture } from './capture-flow';
import { autosaveRoot } from './store/project-store';
import { showHome } from './windows/home';
import { showLibrary } from './windows/library';

let tray: Tray | null = null;

/** The app stays resident in the tray so copied images remain pasteable on Wayland (A7). */
export function createTray(): Tray {
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon);
  tray.setToolTip('Magpie');
  const menu = Menu.buildFromTemplate([
    { label: 'Capture Region', click: () => void runCapture('region') },
    { label: 'Capture Window', click: () => void runCapture('window') },
    { label: 'Capture Full Screen', click: () => void runCapture('full') },
    { type: 'separator' },
    { label: 'Library…', click: () => showLibrary() },
    { label: 'Open Project…', click: () => void openProjectDialog() },
    {
      label: 'Open Captures Folder',
      click: async () => {
        const dir = autosaveRoot();
        await mkdir(dir, { recursive: true });
        await shell.openPath(dir);
      },
    },
    { type: 'separator' },
    { label: 'Settings & Diagnostics…', click: () => showHome() },
    { label: 'Quit Magpie', click: () => app.quit() },
  ]);
  tray.setContextMenu(menu);
  // Windows: left click opens home. (GNOME AppIndicator only shows the menu.)
  tray.on('click', () => showHome());
  return tray;
}
