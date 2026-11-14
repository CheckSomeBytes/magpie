import { app, dialog } from 'electron';
import { parseCli, type CliCommand } from '../shared/cli';
import { APP_ID } from '../shared/constants';
import { openProjectFile, runCapture, runPreset } from './capture-flow';
import { disconnectBus } from './capture/portal-dbus';
import { runDoctor } from './doctor';
import { registerHotkeys, unregisterAllHotkeys } from './hotkeys';
import { enablePipeWireCapture, setupDisplayMedia } from './capture/display-media';
import { setupIpc } from './ipc';
import { initOcr } from './library/ocr';
import { closeLibrary, initLibrary } from './library/service';
import { registerAssetProtocol, registerMediaProtocol, registerPrivilegedSchemes } from './protocols';
import { settings } from './settings';
import { createTray } from './tray';
import { markQuitting } from './windows/editor';
import { showHome } from './windows/home';
import { showLibrary } from './windows/library';

if (process.platform === 'win32') app.setAppUserModelId(APP_ID);
registerPrivilegedSchemes(); // must run before 'ready'
enablePipeWireCapture();

// One resident instance; `magpie --capture region` from a GNOME custom shortcut forwards here (§5).
if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', (_e, argv) => {
    const cmd = parseCli(argv);
    if (!handleCli(cmd)) showHome();
  });

  app.on('before-quit', () => markQuitting());

  // Never quit when the last window closes: tray-resident (A7).
  app.on('window-all-closed', () => {});
  app.on('will-quit', () => {
    unregisterAllHotkeys();
    disconnectBus();
    closeLibrary();
  });

  void app.whenReady().then(start);
}

/** Returns true if the command did something. */
function handleCli(cmd: CliCommand): boolean {
  let acted = false;
  for (const f of cmd.open) {
    void openProjectFile(f);
    acted = true;
  }
  if (cmd.capture) {
    void runCapture(cmd.capture);
    acted = true;
  }
  if (cmd.preset) {
    runPreset(cmd.preset);
    acted = true;
  }
  if (cmd.library) {
    showLibrary();
    acted = true;
  }
  return acted;
}

async function start(): Promise<void> {
  settings.load();
  const cmd = parseCli(process.argv);

  if (cmd.doctor) {
    const items = await runDoctor([]);
    for (const i of items) console.log(`[${i.level}] ${i.message}`);
    app.exit(items.some((i) => i.level === 'error') ? 1 : 0);
    return;
  }

  setupIpc();
  setupDisplayMedia();
  registerAssetProtocol();
  registerMediaProtocol();
  createTray();
  // Index in the background; never block startup on it.
  initOcr();
  initLibrary().catch((err) => console.error('[library] init failed', err));
  const hotkeys = registerHotkeys(settings.get(), (mode) => void runCapture(mode), runPreset);

  const acted = handleCli(cmd);
  if (!acted && !process.argv.includes('--hidden')) showHome();

  if (process.platform === 'linux') void firstRunChecks(hotkeys);
}

/** Surface blocking setup problems once, in plain words. */
async function firstRunChecks(hotkeys: ReturnType<typeof registerHotkeys>): Promise<void> {
  try {
    const items = await runDoctor(hotkeys);
    const errors = items.filter((i) => i.level === 'error');
    if (errors.length) {
      void dialog.showMessageBox({
        type: 'warning',
        title: 'Magpie setup',
        message: 'Magpie needs a little setup on this system',
        detail: errors.map((e) => `• ${e.message}`).join('\n\n'),
      });
    }
  } catch (err) {
    console.warn('[doctor] failed', err);
  }
}
