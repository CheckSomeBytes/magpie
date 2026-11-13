import { BrowserWindow, dialog, ipcMain } from 'electron';
import { CH, type CaptureMode, type OverlaySelection, type SavePayload, type Settings } from '../shared/ipc';
import { setLaunchAtLogin } from './autostart';
import { runCapture } from './capture-flow';
import { runDoctor } from './doctor';
import { hotkeyStatus, registerHotkeys, suspendHotkeys } from './hotkeys';
import { settings } from './settings';
import { editorClose, editorCloseReady, editorCopy, editorExportPng, editorInitFor, editorSave } from './windows/editor';
import { overlayCancel, overlayCommit, overlayInitFor } from './windows/overlay';

const MODES: CaptureMode[] = ['region', 'window', 'full'];

export function setupIpc(): void {
  ipcMain.handle(CH.overlayInit, (e) => overlayInitFor(e.sender));
  ipcMain.on(CH.overlayCommit, (e, sel: OverlaySelection) => overlayCommit(e.sender, sel));
  ipcMain.on(CH.overlayCancel, (e) => overlayCancel(e.sender));

  ipcMain.handle(CH.editorInit, (e) => editorInitFor(e.sender));
  ipcMain.handle(CH.editorSave, (e, payload: SavePayload) => editorSave(e.sender, payload));
  ipcMain.handle(CH.editorCopy, (_e, png: Uint8Array) => editorCopy(png));
  ipcMain.handle(CH.editorExportPng, (e, png: Uint8Array) => editorExportPng(e.sender, png));
  ipcMain.on(CH.editorCloseReady, (e) => editorCloseReady(e.sender));
  ipcMain.on(CH.editorClose, (e) => editorClose(e.sender));

  ipcMain.on(CH.capture, (_e, mode: CaptureMode) => {
    if (MODES.includes(mode)) void runCapture(mode);
  });

  ipcMain.handle(CH.getSettings, () => settings.get());
  ipcMain.handle(CH.setSettings, async (_e, patch: Partial<Settings>) => {
    const next = await settings.update(patch);
    if (patch.hotkeys) registerHotkeys(next.hotkeys, (m) => void runCapture(m));
    if (patch.launchAtLogin !== undefined) await setLaunchAtLogin(next.launchAtLogin);
    return { settings: next, hotkeys: hotkeyStatus() };
  });
  ipcMain.handle(CH.hotkeyStatus, () => hotkeyStatus());
  ipcMain.on(CH.suspendHotkeys, (_e, s: boolean) => suspendHotkeys(Boolean(s)));
  ipcMain.handle(CH.chooseFolder, async (e) => {
    const win = BrowserWindow.fromWebContents(e.sender) ?? undefined;
    const opts = { title: 'Choose captures folder', properties: ['openDirectory', 'createDirectory'] as Array<'openDirectory' | 'createDirectory'> };
    const res = win ? await dialog.showOpenDialog(win, opts) : await dialog.showOpenDialog(opts);
    return res.canceled ? null : res.filePaths[0] ?? null;
  });
  ipcMain.handle(CH.runDoctor, () => runDoctor(hotkeyStatus()));
}
