import { app } from 'electron';
import { mkdir, rm, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_ID, APP_NAME } from '../shared/constants';

/** §13: ~/.config/autostart on Linux, login items on Windows. */
export async function setLaunchAtLogin(enabled: boolean): Promise<void> {
  if (process.platform === 'win32') {
    app.setLoginItemSettings({ openAtLogin: enabled, args: ['--hidden'] });
    return;
  }
  if (process.platform !== 'linux') return;
  const dir = join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'autostart');
  const file = join(dir, `${APP_ID}.desktop`);
  if (!enabled) {
    await rm(file, { force: true });
    return;
  }
  // AppImage sets $APPIMAGE; otherwise use the running executable.
  const exec = process.env.APPIMAGE || process.execPath;
  await mkdir(dir, { recursive: true });
  await writeFile(
    file,
    [
      '[Desktop Entry]',
      'Type=Application',
      `Name=${APP_NAME}`,
      `Exec="${exec}" --hidden`,
      `Icon=${APP_ID}`,
      'X-GNOME-Autostart-enabled=true',
      'NoDisplay=true',
      '',
    ].join('\n'),
  );
}
