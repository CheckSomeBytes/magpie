/**
 * Global hotkeys (§5). On Wayland, globalShortcut goes through the
 * GlobalShortcuts portal; that needs a valid desktopName matching an
 * installed .desktop file or GNOME silently denies every bind.
 */
import { globalShortcut } from 'electron';
import type { CaptureMode, HotkeyStatus, Settings } from '../shared/ipc';

let status: HotkeyStatus[] = [];

export function registerHotkeys(
  s: Settings,
  onCapture: (mode: CaptureMode) => void,
  onPreset: (id: string) => void,
): HotkeyStatus[] {
  globalShortcut.unregisterAll();
  const bind = (mode: HotkeyStatus['mode'], accelerator: string, fn: () => void): HotkeyStatus => {
    if (!accelerator) return { mode, accelerator, ok: false };
    let ok = false;
    try {
      ok = globalShortcut.register(accelerator, fn);
    } catch (err) {
      console.warn(`[hotkeys] ${accelerator} rejected`, err);
    }
    if (!ok) console.warn(`[hotkeys] could not register ${accelerator} for ${mode} (taken by another app or denied by the portal)`);
    return { mode, accelerator, ok };
  };
  status = [
    ...(Object.keys(s.hotkeys) as CaptureMode[]).map((mode) => bind(mode, s.hotkeys[mode], () => onCapture(mode))),
    ...s.capturePresets.filter((p) => p.hotkey).map((p) => bind(`preset:${p.id}`, p.hotkey, () => onPreset(p.id))),
  ];
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
