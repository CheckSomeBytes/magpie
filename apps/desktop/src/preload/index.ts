import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron';
import { CH, type MagpieApi } from '../shared/ipc';

function listen<T extends unknown[]>(channel: string, cb: (...args: T) => void): () => void {
  const fn = (_e: IpcRendererEvent, ...args: unknown[]) => cb(...(args as T));
  ipcRenderer.on(channel, fn);
  return () => ipcRenderer.removeListener(channel, fn);
}

const api: MagpieApi = {
  platform: process.platform,

  overlayInit: () => ipcRenderer.invoke(CH.overlayInit),
  overlayCommit: (sel) => ipcRenderer.send(CH.overlayCommit, sel),
  overlayCancel: () => ipcRenderer.send(CH.overlayCancel),
  onOverlayDisplay: (cb) => listen<[string]>(CH.overlayDisplay, cb),

  editorInit: () => ipcRenderer.invoke(CH.editorInit),
  editorSave: (payload) => ipcRenderer.invoke(CH.editorSave, payload),
  editorCopy: (png) => ipcRenderer.invoke(CH.editorCopy, png),
  editorExportPng: (png) => ipcRenderer.invoke(CH.editorExportPng, png),
  editorCloseReady: () => ipcRenderer.send(CH.editorCloseReady),
  editorClose: () => ipcRenderer.send(CH.editorClose),
  onEditorRequestClose: (cb) => listen<[]>(CH.editorRequestClose, cb),

  capture: (mode) => ipcRenderer.send(CH.capture, mode),
  getSettings: () => ipcRenderer.invoke(CH.getSettings),
  setSettings: (patch) => ipcRenderer.invoke(CH.setSettings, patch),
  getHotkeyStatus: () => ipcRenderer.invoke(CH.hotkeyStatus),
  suspendHotkeys: (s) => ipcRenderer.send(CH.suspendHotkeys, s),
  chooseFolder: () => ipcRenderer.invoke(CH.chooseFolder),
  runDoctor: () => ipcRenderer.invoke(CH.runDoctor),
};

contextBridge.exposeInMainWorld('magpie', api);
