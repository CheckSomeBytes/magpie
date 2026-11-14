import { BrowserWindow, clipboard, dialog, ipcMain } from 'electron';
import { CAPTURE_MODES, CH, type CaptureMode, type LibraryQuery, type OverlaySelection, type SavePayload, type Settings } from '../shared/ipc';
import { setLaunchAtLogin } from './autostart';
import { openProjectFile, runCapture, runPreset } from './capture-flow';
import { runDoctor } from './doctor';
import { hotkeyStatus, registerHotkeys, suspendHotkeys } from './hotkeys';
import * as library from './library/service';
import { settings } from './settings';
import * as stamps from './stamps';
import { editorClose, editorCloseReady, editorCopy, editorExportPng, editorInitFor, editorSave } from './windows/editor';
import { showLibrary } from './windows/library';
import { scrollCancel, scrollFinish, scrollInit, scrollPhase } from './windows/scroll';
import { overlayCancel, overlayCommit, overlayInitFor } from './windows/overlay';

const MODES: readonly CaptureMode[] = CAPTURE_MODES;

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
    if (patch.hotkeys || patch.capturePresets) registerHotkeys(next, (m) => void runCapture(m), runPreset);
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

  ipcMain.handle(CH.copyText, (_e, text: string) => clipboard.writeText(String(text ?? '')));
  ipcMain.handle(CH.listStamps, () => stamps.listStamps());
  ipcMain.handle(CH.importStamp, (e) => stamps.importStamp(BrowserWindow.fromWebContents(e.sender) ?? undefined));
  ipcMain.handle(CH.saveStamp, (_e, name: string, png: Uint8Array) => stamps.saveStamp(String(name ?? ''), png));
  ipcMain.handle(CH.deleteStamp, (_e, id: string) => stamps.deleteStamp(String(id)));
  ipcMain.on(CH.runPreset, (_e, id: string) => runPreset(String(id)));
  ipcMain.handle(CH.libraryOcrText, (_e, id: number) => library.lib().ocrText(Number(id)));

  ipcMain.handle(CH.scrollInit, (e) => scrollInit(e.sender));
  ipcMain.handle(CH.scrollPhase, (e, phase) => scrollPhase(e.sender, phase));
  ipcMain.handle(CH.scrollFinish, (e, png: Uint8Array) => scrollFinish(e.sender, png));
  ipcMain.on(CH.scrollCancel, (e) => scrollCancel(e.sender));

  const ids = (v: unknown): number[] => (Array.isArray(v) ? v.filter((x): x is number => Number.isInteger(x)) : []);
  ipcMain.on(CH.openLibrary, () => showLibrary());
  ipcMain.handle(CH.libraryQuery, (_e, q: LibraryQuery) => library.libraryQuery(q ?? {}));
  ipcMain.handle(CH.libraryOverview, () => library.libraryOverview());
  ipcMain.handle(CH.librarySetTitle, (_e, id: number, title: string) => library.setTitle(id, String(title ?? '')));
  ipcMain.handle(CH.libraryAddTag, (_e, list: unknown, tag: string) => library.addTag(ids(list), String(tag ?? '')));
  ipcMain.handle(CH.libraryRemoveTag, (_e, list: unknown, tag: string) => library.removeTag(ids(list), String(tag ?? '')));
  ipcMain.handle(CH.libraryTrash, (e, list: unknown) => library.trash(ids(list), BrowserWindow.fromWebContents(e.sender) ?? undefined));
  ipcMain.on(CH.libraryOpen, (_e, list: unknown) => {
    for (const p of library.libraryPaths(ids(list).slice(0, 12))) void openProjectFile(p);
  });
  ipcMain.on(CH.libraryReveal, (_e, id: number) => library.reveal(id));
  ipcMain.handle(CH.libraryRescan, () => library.rescan());
}
