/**
 * Global hotkeys (§5). On Wayland, globalShortcut goes through the
 * GlobalShortcuts portal; that needs a valid desktopName matching an
 * installed .desktop file or GNOME silently denies every bind.
 */
import { globalShortcut } from 'electron';
import type { CaptureMode, HotkeyStatus, Settings } from '../shared/ipc';

let status: HotkeyStatus[] = [];

export function registerHotkeys(hotkeys: Settings['hotkeys'], onCapture: (mode: CaptureMode) => void): HotkeyStatus[] {
  globalShortcut.unregisterAll();
  status = (Object.keys(hotkeys) as CaptureMode[]).map((mode) => {
    const accelerator = hotkeys[mode];
    if (!accelerator) return { mode, accelerator, ok: false };
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, () => onCapture(mode));
    } catch (err) {
      console.warn(`[hotkeys] ${accelerator} rejected`, err);
    }
    if (!ok) console.warn(`[hotkeys] could not register ${accelerator} for ${mode} (taken by another app or denied by the portal)`);
    return { mode, accelerator, ok };
  });
  return status;
}

export function hotkeyStatus(): HotkeyStatus[] {
  return status;
}

/** While the settings UI records a new shortcut (Electron ≥ 42). */
export function suspendHotkeys(suspended: boolean): void {
  const gs = globalShortcut as typeof globalShortcut & { setSuspended?: (s: boolean) => void };
  if (gs.setSuspended) gs.setSuspended(suspended);
}

export function unregisterAllHotkeys(): void {
  globalShortcut.unregisterAll();
}
