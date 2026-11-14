/**
 * Screen recording session (Phase 5, §12). The renderer records with
 * MediaRecorder and streams WebM chunks here; they go straight to disk
 * ("….webm.part"), so long recordings never sit in memory. On finish the
 * file is remuxed (MediaRecorder WebM has no duration/cues, so it can't be
 * seeked) and opened for review.
 */
import { BrowserWindow, screen, type WebContents } from 'electron';
import { open, rename, rm, type FileHandle } from 'node:fs/promises';
import { CH, type RecordInit } from '../../shared/ipc';
import { lastStreamDisplay } from '../capture/display-media';
import { remux } from '../media/ffmpeg';
import { settings } from '../settings';
import { newCapturePath, projectEvents } from '../store/project-store';
import { createAppWindow } from './common';
import { openVideo } from './video';

let win: BrowserWindow | null = null;
let recording = false;
let file: FileHandle | null = null;
let partPath = '';
let finalPath = '';

export function isRecording(): boolean {
  return recording;
}

/** The video hotkey: start a recording, or stop the one in progress. */
export function startRecording(): void {
  if (win && !win.isDestroyed()) {
    if (recording) win.webContents.send(CH.recordStop);
    else win.focus();
    return;
  }
  recording = false;
  win = createAppWindow('record', {
    width: 360,
    height: 132,
    frame: false,
    resizable: false,
    title: 'Magpie recording',
    backgroundColor: '#1b1d22',
    webPreferences: { backgroundThrottling: false },
  });
  // Hidden until the stream is live (the portal shows its own dialog on Wayland).
  win.on('closed', () => {
    win = null;
    recording = false;
    void cleanupPart();
  });
}

function sender(e: WebContents): BrowserWindow {
  if (!win || win.isDestroyed() || e.id !== win.webContents.id) throw new Error('Not the recording window');
  return win;
}

export function recordInit(e: WebContents): RecordInit {
  sender(e);
  const s = settings.get();
  return {
    fake: !!process.env['MAGPIE_FAKE_VIDEO'],
    mic: s.recordMic,
    systemAudio: s.recordSystemAudio && process.platform === 'win32',
    stopHotkey: s.hotkeys.video ?? '',
  };
}

export async function recordStart(e: WebContents): Promise<void> {
  const w = sender(e);
  finalPath = await newCapturePath(new Date(), '.webm');
  partPath = `${finalPath}.part`;
  file = await open(partPath, 'w');
  recording = true;

  // Small always-on-top panel in the corner of the recorded display.
  const target = lastStreamDisplay() ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint());
  const wa = target.workArea;
  const size = { width: 360, height: 132 };
  w.setBounds({ x: wa.x + wa.width - size.width - 24, y: wa.y + wa.height - size.height - 24, ...size });
  w.setAlwaysOnTop(true, 'floating');
  if (process.platform === 'win32') w.setContentProtection(true); // keep the panel out of the video
  w.showInactive();
}

export async function recordChunk(e: WebContents, bytes: Uint8Array): Promise<void> {
  sender(e);
  if (!file) throw new Error('Recording has not started');
  await file.write(bytes);
}

export async function recordFinish(e: WebContents): Promise<void> {
  const w = sender(e);
  recording = false;
  await file?.close();
  file = null;
  const part = partPath;
  const out = finalPath;
  partPath = '';
  w.destroy();
  try {
    await remux(part, out);
    await rm(part, { force: true });
  } catch (err) {
    // No ffmpeg (or it failed): keep the raw recording; it plays, just without seeking.
    console.warn('[record] remux failed, keeping raw WebM', err);
    await rename(part, out);
  }
  projectEvents.emit('written', out); // index it now
  openVideo(out);
}

export function recordCancel(e: WebContents): void {
  sender(e).destroy(); // 'closed' removes the .part file
}

async function cleanupPart(): Promise<void> {
  const f = file;
  const p = partPath;
  file = null;
  partPath = '';
  await f?.close().catch(() => {});
  if (p) await rm(p, { force: true }).catch(() => {});
}
