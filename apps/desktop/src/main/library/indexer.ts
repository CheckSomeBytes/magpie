/**
 * Scan the captures folder and keep the index in sync. Pure Node (no Electron).
 * Files are re-read only when mtime or size changed.
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
import { annotationText, normalizeTags, peekProject } from '@magpie/format';
import type { CaptureRecord, LibraryDb } from './db';

export interface FileStamp {
  path: string;
  mtime: number;
  size: number;
}

export function isProjectFile(name: string): boolean {
  return name.toLowerCase().endsWith('.magpie') && !name.startsWith('.');
}

/** Recursively list .magpie files (skips dot-dirs and our .tmp- files). */
export async function listProjects(root: string): Promise<FileStamp[]> {
  const out: FileStamp[] = [];
  async function walk(dir: string): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const p = join(dir, e.name);
      if (e.isDirectory()) await walk(p);
      else if (e.isFile() && isProjectFile(e.name)) {
        try {
          const s = await stat(p);
          out.push({ path: p, mtime: s.mtimeMs, size: s.size });
        } catch {
          /* vanished */
        }
      }
    }
  }
  await walk(root);
  return out;
}

export async function readRecord(file: FileStamp): Promise<CaptureRecord> {
  const { manifest, doc, thumb } = peekProject(await readFile(file.path));
  return {
    path: file.path,
    title: manifest.title?.trim() || null,
    createdAt: manifest.created,
    modifiedAt: manifest.modified,
    width: manifest.image.widthPx,
    height: manifest.image.heightPx,
    appHint: null,
    ocrText: null,
    annotationCount: doc.annotations.length,
    annotationText: annotationText(doc),
    tags: normalizeTags(manifest.tags ?? []),
    fileMtime: file.mtime,
    fileSize: file.size,
    thumb,
    thumbMime: thumb ? (manifest.thumb === 'thumb.webp' ? 'image/webp' : 'image/png') : null,
  };
}

export interface ScanResult {
  added: number;
  updated: number;
  removed: number;
  failed: Array<{ path: string; error: string }>;
}

const yieldToLoop = () => new Promise<void>((r) => setImmediate(r));

/** Full sync of `root` into the index: add/update changed files, drop missing ones. */
export async function syncFolder(db: LibraryDb, root: string): Promise<ScanResult> {
  const files = await listProjects(root);
  const known = db.fileStamps();
  const res: ScanResult = { added: 0, updated: 0, removed: 0, failed: [] };
  let i = 0;
  for (const f of files) {
    const k = known.get(f.path);
    known.delete(f.path);
    if (k && Math.abs(k.mtime - f.mtime) < 1 && k.size === f.size) continue;
    try {
      db.upsert(await readRecord(f));
      if (k) res.updated++;
      else res.added++;
    } catch (err) {
      res.failed.push({ path: f.path, error: (err as Error).message });
    }
    if (++i % 25 === 0) await yieldToLoop(); // keep the main process responsive on big libraries
  }
  // Anything left in `known` is gone from disk (or outside the current root).
  res.removed = db.removePaths(known.keys());
  return res;
}

/** Re-index specific paths (from the watcher or our own saves). */
export async function syncPaths(db: LibraryDb, paths: Iterable<string>): Promise<ScanResult> {
  const res: ScanResult = { added: 0, updated: 0, removed: 0, failed: [] };
  const known = db.fileStamps();
  const gone: string[] = [];
  for (const path of paths) {
    let s;
    try {
      s = await stat(path);
    } catch {
      gone.push(path);
      continue;
    }
    const k = known.get(path);
    if (k && Math.abs(k.mtime - s.mtimeMs) < 1 && k.size === s.size) continue;
    try {
      db.upsert(await readRecord({ path, mtime: s.mtimeMs, size: s.size }));
      if (k) res.updated++;
      else res.added++;
    } catch (err) {
      // Half-written by another tool? The watcher will fire again when it settles.
      res.failed.push({ path, error: (err as Error).message });
    }
  }
  res.removed = db.removePaths(gone);
  return res;
}
