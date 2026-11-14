/**
 * Video review window (Phase 5): play, trim, export MP4 / GIF / trimmed WebM.
 */
import { BrowserWindow, dialog, shell, type WebContents } from 'electron';
import { existsSync } from 'node:fs';
import { basename, extname, join, dirname } from 'node:path';
import { CH, type VideoExport, type VideoInit } from '../../shared/ipc';
import { exportVideo, probe } from '../media/ffmpeg';
import { sidecarPath } from '../media/sidecar';
import { forgetMedia, mediaUrl } from '../protocols';
import { projectEvents } from '../store/project-store';
import { createAppWindow } from './common';

const sessions = new Map<number, { path: string; win: BrowserWindow; exporting: boolean }>();

export function openVideo(path: string): BrowserWindow {
  for (const s of sessions.values()) {
    if (s.path === path && !s.win.isDestroyed()) {
      s.win.show();
      s.win.focus();
      return s.win;
    }
  }
  const win = createAppWindow('video', {
    width: 1040,
    height: 760,
    minWidth: 640,
    minHeight: 480,
    title: `${basename(path)} — Magpie`,
    backgroundColor: '#1b1d22',
  });
  const id = win.webContents.id;
  sessions.set(id, { path, win, exporting: false });
  win.once('ready-to-show', () => {
    win.show();
    win.focus();
  });
  win.on('closed', () => {
    sessions.delete(id);
    if (![...sessions.values()].some((s) => s.path === path)) forgetMedia(path);
  });
  return win;
}

function session(e: WebContents) {
  const s = sessions.get(e.id);
  if (!s) throw new Error('No video session for this window');
  return s;
}

export async function videoInit(e: WebContents): Promise<VideoInit> {
  const s = session(e);
  const info = await probe(s.path);
  return {
    path: s.path,
    name: basename(s.path),
    url: mediaUrl(s.path),
    duration: Number.isFinite(info.duration) ? info.duration : 0,
    width: info.width,
    height: info.height,
    hasAudio: info.hasAudio,
  };
}

/** "<base> (trim).webm", "<base>.mp4", "<base>.gif" next to the source, never overwriting. */
function outputPath(src: string, kind: VideoExport['kind']): string {
  const base = join(dirname(src), basename(src, extname(src)));
  const stem = kind === 'webm' ? `${base} (trim)` : base;
  let p = `${stem}.${kind}`;
  for (let i = 2; existsSync(p) || p === src; i++) p = `${stem} (${i}).${kind}`;
  return p;
}

export async function videoExport(e: WebContents, opts: VideoExport): Promise<string> {
  const s = session(e);
  if (s.exporting) throw new Error('An export is already running.');
  s.exporting = true;
  const out = outputPath(s.path, opts.kind);
  try {
    await exportVideo(s.path, out, {
      ...opts,
      onProgress: (f) => {
        if (!s.win.isDestroyed()) s.win.webContents.send(CH.videoProgress, f);
      },
    });
  } finally {
    s.exporting = false;
  }
  if (opts.kind !== 'gif') projectEvents.emit('written', out); // MP4/WebM show up in the library
  return out;
}

export function videoReveal(e: WebContents, path?: string): void {
  const s = session(e);
  shell.showItemInFolder(path && existsSync(path) ? path : s.path);
}

export async function videoTrash(e: WebContents): Promise<boolean> {
  const s = session(e);
  const { response } = await dialog.showMessageBox(s.win, {
    type: 'warning',
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: 'Move this recording to the Trash?',
    detail: basename(s.path),
  });
  if (response !== 0) return false;
  s.win.destroy();
  await shell.trashItem(s.path);
  await shell.trashItem(sidecarPath(s.path)).catch(() => {});
  return true;
}
