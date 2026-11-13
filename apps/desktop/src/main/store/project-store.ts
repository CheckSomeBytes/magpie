/**
 * .magpie read/write on disk and the autosave folder (§8).
 * Pure format logic lives in @magpie/format; this file only does fs + naming.
 */
import { app, nativeImage } from 'electron';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import {
  FILE_EXTENSION,
  FORMAT_ID,
  FORMAT_VERSION,
  emptyDoc,
  packProject,
  unpackProject,
  type AnnotationDoc,
  type DisplayInfo,
  type MagpieProject,
} from '@magpie/format';
import { APP_NAME } from '../../shared/constants';
import { settings } from '../settings';

export function autosaveRoot(): string {
  return settings.get().autosaveDir ?? join(app.getPath('pictures'), APP_NAME);
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

/** ~/Pictures/Magpie/YYYY/MM/Magpie 2026-11-13 15.04.05.magpie (unique). */
async function newProjectPath(at: Date): Promise<string> {
  const dir = join(autosaveRoot(), String(at.getFullYear()), pad(at.getMonth() + 1));
  await mkdir(dir, { recursive: true });
  const stamp = `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}.${pad(at.getMinutes())}.${pad(at.getSeconds())}`;
  let path = join(dir, `${APP_NAME} ${stamp}${FILE_EXTENSION}`);
  for (let i = 2; existsSync(path); i++) path = join(dir, `${APP_NAME} ${stamp} (${i})${FILE_EXTENSION}`);
  return path;
}

/** Write atomically so a crash mid-save never leaves a truncated project. */
async function writeAtomic(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true });
  const tmp = `${path}.tmp-${process.pid}`;
  await writeFile(tmp, bytes);
  await rename(tmp, path);
}

function quickThumb(png: Buffer): Buffer {
  const img = nativeImage.createFromBuffer(png);
  const { width } = img.getSize();
  return (width > 320 ? img.resize({ width: 320, quality: 'good' }) : img).toPNG();
}

export interface NewCapture {
  png: Buffer;
  widthPx: number;
  heightPx: number;
  displays: DisplayInfo[];
  source: 'portal' | 'desktopCapturer' | 'import';
  capturedAt: string;
}

/** Every capture is autosaved as a .magpie immediately (§8). */
export async function createProjectFromCapture(c: NewCapture): Promise<{ path: string; project: MagpieProject }> {
  const at = new Date(c.capturedAt);
  const path = await newProjectPath(at);
  const project: MagpieProject = {
    manifest: {
      format: FORMAT_ID,
      version: FORMAT_VERSION,
      app: { name: APP_NAME, version: app.getVersion() },
      created: c.capturedAt,
      modified: c.capturedAt,
      os: { platform: process.platform, release: release(), session: process.env.XDG_SESSION_TYPE },
      image: { widthPx: c.widthPx, heightPx: c.heightPx },
      source: c.source,
      displays: c.displays,
      thumb: 'thumb.png',
    },
    original: c.png,
    doc: emptyDoc(),
    thumb: quickThumb(c.png),
  };
  await writeAtomic(path, packProject(project));
  return { path, project };
}

export async function loadProject(path: string): Promise<MagpieProject> {
  return unpackProject(await readFile(path));
}

/** Re-save annotations (and a fresh thumbnail) into an existing project. */
export async function saveProject(
  path: string,
  base: MagpieProject,
  doc: AnnotationDoc,
  thumbWebp: Uint8Array | null,
): Promise<MagpieProject> {
  const project: MagpieProject = {
    manifest: {
      ...base.manifest,
      modified: new Date().toISOString(),
      thumb: thumbWebp ? 'thumb.webp' : base.manifest.thumb,
    },
    original: base.original,
    doc,
    thumb: thumbWebp ?? base.thumb,
  };
  await writeAtomic(path, packProject(project));
  return project;
}

export async function writePngBeside(projectPath: string, png: Uint8Array): Promise<string> {
  const out = projectPath.replace(/\.magpie$/i, '') + '.png';
  await writeAtomic(out, png);
  return out;
}
