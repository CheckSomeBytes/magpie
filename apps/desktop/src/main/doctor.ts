/**
 * Startup "doctor" (§4.1): reports missing portal pieces in plain words.
 */
import { app } from 'electron';
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { APP_ID } from '../shared/constants';
import type { DoctorItem, HotkeyStatus } from '../shared/ipc';
import { PORTAL_IFACES, portalHasInterface, portalInterfaceVersion } from './capture/portal-dbus';

export function desktopFileCandidates(): string[] {
  const file = `${APP_ID}.desktop`;
  const dataHome = process.env.XDG_DATA_HOME || join(homedir(), '.local/share');
  const dataDirs = (process.env.XDG_DATA_DIRS || '/usr/local/share:/usr/share').split(':');
  return [dataHome, ...dataDirs].map((d) => join(d, 'applications', file));
}

export async function runDoctor(hotkeys: HotkeyStatus[]): Promise<DoctorItem[]> {
  const items: DoctorItem[] = [];
  const ok = (message: string) => items.push({ level: 'ok', message });
  const warn = (message: string) => items.push({ level: 'warn', message });
  const error = (message: string) => items.push({ level: 'error', message });

  ok(`Magpie ${app.getVersion()} on Electron ${process.versions.electron}, ${process.platform}`);

  if (process.platform === 'linux') {
    const session = process.env.XDG_SESSION_TYPE ?? 'unknown';
    if (session === 'wayland') ok('Wayland session');
    else warn(`Session type is "${session}". Magpie is built for GNOME on Wayland.`);

    let desktopName = '';
    try {
      desktopName = (JSON.parse(readFileSync(join(app.getAppPath(), 'package.json'), 'utf8')) as { desktopName?: string }).desktopName ?? '';
    } catch {
      /* reported below */
    }
    if (desktopName !== `${APP_ID}.desktop`) {
      error(`desktopName is "${desktopName || 'unset'}", expected "${APP_ID}.desktop". Hotkeys and screenshot permission depend on it.`);
    }
    const found = desktopFileCandidates().find((p) => existsSync(p));
    if (found) ok(`Desktop entry installed: ${found}`);
    else error(`No ${APP_ID}.desktop installed. GNOME will deny global shortcuts. Run "npm run install-desktop-entry" (dev) or install the .deb.`);

    const shotVersion = await portalInterfaceVersion(PORTAL_IFACES.screenshot);
    if (shotVersion === 0) {
      error('Screenshot portal not found. Install xdg-desktop-portal and xdg-desktop-portal-gnome, then log out and back in.');
    } else if (shotVersion < 2) {
      warn(`Screenshot portal is version ${shotVersion}; version 2 is needed for silent captures. Every capture will show a dialog.`);
    } else ok(`Screenshot portal version ${shotVersion}`);

    if (await portalHasInterface(PORTAL_IFACES.globalShortcuts)) ok('GlobalShortcuts portal available');
    else warn('GlobalShortcuts portal not found (needs GNOME 48+). Use a GNOME custom shortcut running "magpie --capture=region".');
  }

  for (const h of hotkeys) {
    if (h.ok) ok(`Hotkey ${h.accelerator} → ${h.mode}`);
    else warn(`Hotkey ${h.accelerator || '(none)'} for ${h.mode} is not active. It may be taken (GNOME uses Print itself) or was declined. Change it in Settings.`);
  }
  return items;
}
