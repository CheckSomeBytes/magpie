import { app, BrowserWindow, dialog, screen, type WebContents } from 'electron';
import { writeFile } from 'node:fs/promises';
import { basename } from 'node:path';
import type { AnnotationType, MagpieProject } from '@magpie/format';
import { CH, type EditorInit, type SavePayload } from '../../shared/ipc';
import { copyPng } from '../clipboard';
import { settings } from '../settings';
import { saveProject, writePngBeside } from '../store/project-store';
import { createAppWindow } from './common';

type StartTool = AnnotationType | 'select' | 'crop' | null;

interface EditorSession {
  path: string;
  project: MagpieProject;
  startTool: StartTool;
  win: BrowserWindow;
  closeReady: boolean;
  saving: Promise<unknown>;
}

const sessions = new Map<number, EditorSession>();

/**
 * Quitting with editors open: each editor cancels its first close to flush an
 * autosave, which also cancels the app quit. Remember that a quit was asked
 * for and re-issue it as each editor finishes closing.
 */
let quitting = false;
export function markQuitting(): void {
  quitting = true;
}

export function openEditor(path: string, project: MagpieProject, startTool: StartTool = null): BrowserWindow {
  for (const s of sessions.values()) {
    if (s.path === path && !s.win.isDestroyed()) {
      s.win.show();
      s.win.focus();
      return s.win;
    }
  }

  const work = screen.getPrimaryDisplay().workAreaSize;
  const { widthPx, heightPx } = project.manifest.image;
  // Chrome is ~ 56px toolbar + 36px status; aim for the image at 100% when it fits.
  const width = Math.round(Math.min(work.width * 0.9, Math.max(960, widthPx + 48)));
  const height = Math.round(Math.min(work.height * 0.9, Math.max(640, heightPx + 140)));

  const win = createAppWindow('editor', {
    width,
    height,
    minWidth: 720,
    minHeight: 480,
    title: `${basename(path)} — Magpie`,
    backgroundColor: '#1b1d22',
  });
  const session: EditorSession = { path, project, startTool, win, closeReady: false, saving: Promise.resolve() };
  const id = win.webContents.id;
  sessions.set(id, session);

  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });

  // Close handshake: let the renderer flush its autosave before the window goes.
  win.on('close', (e) => {
    if (session.closeReady) return;
    e.preventDefault();
    win.webContents.send(CH.editorRequestClose);
    setTimeout(() => {
      if (!win.isDestroyed()) {
        session.closeReady = true;
        win.close();
      }
    }, 4000);
  });
  win.on('closed', () => {
    sessions.delete(id);
    if (quitting) setImmediate(() => app.quit());
  });
  return win;
}

function sessionFor(sender: WebContents): EditorSession {
  const s = sessions.get(sender.id);
  if (!s) throw new Error('No editor session for this window');
  return s;
}

export function editorInitFor(sender: WebContents): EditorInit {
  const s = sessionFor(sender);
  return {
    path: s.path,
    manifest: s.project.manifest,
    original: s.project.original,
    doc: s.project.doc,
    startTool: s.startTool,
    settings: settings.get(),
    assets: s.project.assets ?? {},
  };
}

export async function editorSave(sender: WebContents, payload: SavePayload): Promise<{ path: string }> {
  const s = sessionFor(sender);
  // Serialize saves per window so an autosave never races an explicit save.
  const run = s.saving.then(async () => {
    s.project = await saveProject(s.path, s.project, payload.doc, payload.thumbWebp, payload.assets);
    if (payload.flattenedPng) await writePngBeside(s.path, payload.flattenedPng);
  });
  s.saving = run.catch(() => {});
  await run;
  return { path: s.path };
}

export async function editorCopy(png: Uint8Array): Promise<void> {
  await copyPng(png);
}

export async function editorExportPng(sender: WebContents, png: Uint8Array): Promise<string | null> {
  const s = sessionFor(sender);
  const res = await dialog.showSaveDialog(s.win, {
    title: 'Export PNG',
    defaultPath: s.path.replace(/\.magpie$/i, '.png'),
    filters: [{ name: 'PNG image', extensions: ['png'] }],
  });
  if (res.canceled || !res.filePath) return null;
  await writeFile(res.filePath, png);
  return res.filePath;
}

export function editorCloseReady(sender: WebContents): void {
  const s = sessions.get(sender.id);
  if (!s) return;
  s.closeReady = true;
  if (!s.win.isDestroyed()) s.win.close();
}

export function editorClose(sender: WebContents): void {
  const s = sessions.get(sender.id);
  if (s && !s.win.isDestroyed()) s.win.close();
}

export function editorWindows(): BrowserWindow[] {
  return [...sessions.values()].map((s) => s.win).filter((w) => !w.isDestroyed());
}

/** Close editors on a file without saving (it is about to be trashed). */
export function closeEditorsForPath(path: string): void {
  for (const s of sessions.values()) {
    if (s.path === path && !s.win.isDestroyed()) {
      s.closeReady = true;
      s.win.destroy();
    }
  }
}
