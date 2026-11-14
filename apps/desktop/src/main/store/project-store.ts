/**
 * .magpie read/write on disk and the autosave folder (§8).
 * Pure format logic lives in @magpie/format; this file only does fs + naming.
 */
import { app, nativeImage } from 'electron';
import { EventEmitter } from 'node:events';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { release } from 'node:os';
import { dirname, join } from 'node:path';
import {
  FILE_EXTENSION,
  FORMAT_ID,
  FORMAT_VERSION,
  emptyDoc,
  normalizeTags,
  packProject,
  peekProject,
  unpackProject,
  usedAssets,
  type AnnotationDoc,
  type DisplayInfo,
  type MagpieProject,
  type Manifest,
} from '@magpie/format';
import { APP_NAME } from '../../shared/constants';
import { settings } from '../settings';

/** Emits 'written' (path) after every successful project write, so the library can re-index at once. */
export const projectEvents = new EventEmitter();

/** Serialize writes per file: the editor's autosave and a library tag edit must never interleave. */
const locks = new Map<string, Promise<unknown>>();
async function withFileLock<T>(path: string, fn: () => Promise<T>): Promise<T> {
  const prev = locks.get(path) ?? Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  const tail = run.catch(() => {});
  locks.set(path, tail);
  try {
    return await run;
  } finally {
    if (locks.get(path) === tail) locks.delete(path);
  }
}

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
  if (path.toLowerCase().endsWith(FILE_EXTENSION)) projectEvents.emit('written', path);
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
  tags?: string[];
  title?: string;
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
      ...(c.tags?.length ? { tags: normalizeTags(c.tags) } : {}),
      ...(c.title?.trim() ? { title: c.title.trim() } : {}),
    },
    original: c.png,
    doc: emptyDoc(),
    thumb: quickThumb(c.png),
  };
  await withFileLock(path, () => writeAtomic(path, packProject(project)));
  return { path, project };
}

export async function loadProject(path: string): Promise<MagpieProject> {
  return unpackProject(await readFile(path));
}

/**
 * Re-save annotations (and a fresh thumbnail) into an existing project.
 * Title and tags are owned by the library, so take them from disk rather than
 * from the editor's (possibly stale) copy of the manifest.
 */
export async function saveProject(
  path: string,
  base: MagpieProject,
  doc: AnnotationDoc,
  thumbWebp: Uint8Array | null,
  assets?: Record<string, Uint8Array>,
): Promise<MagpieProject> {
  return withFileLock(path, async () => {
    let onDisk: Pick<Manifest, 'title' | 'tags'> = { title: base.manifest.title, tags: base.manifest.tags };
    try {
      const { manifest } = peekProject(await readFile(path));
      onDisk = { title: manifest.title, tags: manifest.tags };
    } catch {
      /* file missing or unreadable: fall back to what the editor has */
    }
    const project: MagpieProject = {
      manifest: {
        ...base.manifest,
        ...onDisk,
        modified: new Date().toISOString(),
        thumb: thumbWebp ? 'thumb.webp' : base.manifest.thumb,
      },
      original: base.original,
      doc,
      thumb: thumbWebp ?? base.thumb,
      assets: usedAssets(doc, assets ?? base.assets),
    };
    await writeAtomic(path, packProject(project));
    return project;
  });
}

/** Library edits (title, tags): read-modify-write the manifest under the file lock. */
export async function updateManifest(path: string, fn: (m: Manifest) => Manifest): Promise<Manifest> {
  return withFileLock(path, async () => {
    const project = unpackProject(await readFile(path));
    const next = fn(project.manifest);
    const manifest: Manifest = {
      ...next,
      title: next.title?.trim() || undefined,
      tags: next.tags ? normalizeTags(next.tags) : undefined,
    };
    await writeAtomic(path, packProject({ ...project, manifest }));
    return manifest;
  });
}

export async function writePngBeside(projectPath: string, png: Uint8Array): Promise<string> {
  const out = projectPath.replace(/\.magpie$/i, '') + '.png';
  await writeAtomic(out, png);
  return out;
}
