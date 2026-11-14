import type { Settings } from './ipc';

export const APP_NAME = 'Magpie';
/** Must equal package.json "desktopName" minus ".desktop" and the installed .desktop file id (§5). */
export const APP_ID = 'works.telesto.Magpie';

export const DEFAULT_SETTINGS: Settings = {
  hotkeys: {
    region: 'PrintScreen',
    window: 'Shift+PrintScreen',
    full: 'Control+PrintScreen',
    scroll: 'Control+Shift+PrintScreen',
    video: 'Control+Alt+PrintScreen',
  },
  linuxRegionMode: 'overlay',
  autosaveDir: null,
  copyOnCapture: false,
  exportPngOnSave: false,
  launchAtLogin: false,
  ocrEnabled: true,
  capturePresets: [],
  recordMic: false,
  recordSystemAudio: false,
};
