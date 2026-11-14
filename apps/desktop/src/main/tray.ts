import { app, Menu, nativeImage, shell, Tray } from 'electron';
import { mkdir } from 'node:fs/promises';
import trayIconPath from '../../resources/icons/tray.png?asset';
import { openProjectDialog, runCapture, runPreset } from './capture-flow';
import { settings } from './settings';
import { autosaveRoot } from './store/project-store';
import { showHome } from './windows/home';
import { showLibrary } from './windows/library';

let tray: Tray | null = null;

/** Fallback notice when the OS has no notification service. */
export function trayNotice(title: string, body: string): void {
  if (!tray) return console.log(`[notice] ${title}: ${body}`);
  if (process.platform === 'win32') tray.displayBalloon({ title, content: body });
  else {
    tray.setToolTip(`Magpie: ${title}`);
    setTimeout(() => tray?.setToolTip('Magpie'), 8000);
  }
  console.log(`[notice] ${title}: ${body}`);
}

/** The app stays resident in the tray so copied images remain pasteable on Wayland (A7). */
export function createTray(): Tray {
  const icon = nativeImage.createFromPath(trayIconPath);
  tray = new Tray(icon);
  tray.setToolTip('Magpie');
  const build = () => {
    const presets = settings.get().capturePresets;
    return Menu.buildFromTemplate([
      { label: 'Capture Region', click: () => void runCapture('region') },
      { label: 'Capture Window', click: () => void runCapture('window') },
      { label: 'Capture Full Screen', click: () => void runCapture('full') },
      { label: 'Scrolling Capture', click: () => void runCapture('scroll') },
      ...(presets.length
        ? [{ label: 'Presets', submenu: presets.map((p) => ({ label: p.name, click: () => runPreset(p.id) })) }]
        : []),
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
  };
  const menu = build();
  settings.onChange((next, prev) => {
    if (next.capturePresets !== prev.capturePresets) tray?.setContextMenu(build());
  });
  tray.setContextMenu(menu);
  // Windows: left click opens home. (GNOME AppIndicator only shows the menu.)
  tray.on('click', () => showHome());
  return tray;
}
