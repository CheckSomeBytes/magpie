/**
 * Library service (Phase 2): owns the index, keeps it in sync with the
 * captures folder, serves thumbnails, and applies edits back to the files.
 */
import { app, BrowserWindow, dialog, protocol, shell } from 'electron';
import { watch, type FSWatcher } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { normalizeTags } from '@magpie/format';
import { CH, type LibraryOverview, type LibraryQuery, type LibraryResult } from '../../shared/ipc';
import { settings } from '../settings';
import { autosaveRoot, projectEvents, updateManifest } from '../store/project-store';
import { closeEditorsForPath } from '../windows/editor';
import { LibraryDb } from './db';
import { isProjectFile, syncFolder, syncPaths } from './indexer';

export const THUMB_SCHEME = 'magpie-thumb';

/** Must run before app 'ready'. */
export function registerLibrarySchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
  ]);
}

let db: LibraryDb | null = null;
let watcher: FSWatcher | null = null;
let watchedRoot = '';
let scanning: Promise<void> | null = null;
const pending = new Set<string>();
let pendingTimer: NodeJS.Timeout | undefined;
let changedTimer: NodeJS.Timeout | undefined;

function lib(): LibraryDb {
  if (!db) throw new Error('Library is not initialised');
  return db;
}

/** Tell every window (library pages listen) that results may have changed. Debounced. */
function broadcastChanged(): void {
  clearTimeout(changedTimer);
  changedTimer = setTimeout(() => {
    for (const w of BrowserWindow.getAllWindows()) if (!w.isDestroyed()) w.webContents.send(CH.libraryChanged);
  }, 150);
}

export async function initLibrary(): Promise<void> {
  const file = join(app.getPath('userData'), 'library.sqlite');
  try {
    db = new LibraryDb(file);
  } catch (err) {
    // A corrupt cache is never worth an error dialog: it's rebuilt from the files.
    console.error('[library] could not open index, rebuilding', err);
    const { rm } = await import('node:fs/promises');
    for (const f of [file, `${file}-wal`, `${file}-shm`]) await rm(f, { force: true });
    db = new LibraryDb(file);
  }

  protocol.handle(THUMB_SCHEME, (req) => {
    const id = Number(new URL(req.url).pathname.replace(/^\//, ''));
    const t = Number.isInteger(id) ? db?.thumb(id) : null;
    if (!t) return new Response(null, { status: 404 });
    return new Response(new Uint8Array(t.data), {
      headers: { 'content-type': t.mime, 'cache-control': 'max-age=31536000, immutable' },
    });
  });

  // Our own writes: index right away rather than waiting for the watcher.
  projectEvents.on('written', (path: string) => queue(path));

  settings.onChange((next, prev) => {
    if (next.autosaveDir !== prev.autosaveDir) void startWatching();
  });
  await startWatching();
}

async function startWatching(): Promise<void> {
  const root = autosaveRoot();
  watcher?.close();
  watcher = null;
  watchedRoot = root;
  await mkdir(root, { recursive: true }).catch(() => {});
  try {
    // Recursive watching is supported on Linux (Node ≥ 20) and Windows.
    watcher = watch(root, { recursive: true }, (_event, name) => {
      if (name && isProjectFile(String(name).split(/[\\/]/).pop() ?? '')) queue(join(root, String(name)));
    });
    watcher.on('error', (err) => console.warn('[library] watcher error', err));
  } catch (err) {
    console.warn('[library] could not watch', root, err);
  }
  await rescan();
}

function queue(path: string): void {
  pending.add(path);
  clearTimeout(pendingTimer);
  pendingTimer = setTimeout(() => {
    const paths = [...pending];
    pending.clear();
    void syncPaths(lib(), paths)
      .then((r) => {
        if (r.added || r.updated || r.removed) broadcastChanged();
      })
      .catch((err) => console.warn('[library] sync failed', err));
  }, 300);
}

export function rescan(): Promise<void> {
  if (scanning) return scanning;
  broadcastChanged();
  scanning = (async () => {
    const t0 = performance.now();
    try {
      const r = await syncFolder(lib(), watchedRoot || autosaveRoot());
      console.log(
        `[library] scan: +${r.added} ~${r.updated} -${r.removed}` +
          (r.failed.length ? ` (${r.failed.length} unreadable)` : '') +
          ` in ${Math.round(performance.now() - t0)} ms`,
      );
      for (const f of r.failed.slice(0, 5)) console.warn('[library] skipped', f.path, f.error);
    } finally {
      scanning = null;
      broadcastChanged();
    }
  })();
  return scanning;
}

export function libraryQuery(q: LibraryQuery): LibraryResult {
  return lib().query(q);
}

export function libraryOverview(): LibraryOverview {
  const { all, untagged } = lib().counts();
  return { root: watchedRoot || autosaveRoot(), all, untagged, tags: lib().tags(), scanning: scanning !== null };
}

export function libraryPaths(ids: number[]): string[] {
  return lib().pathsFor(ids);
}

async function editEach(ids: number[], fn: (tags: string[], title: string | undefined) => { tags?: string[]; title?: string }): Promise<void> {
  const errors: string[] = [];
  for (const path of lib().pathsFor(ids)) {
    try {
      await updateManifest(path, (m) => ({ ...m, ...fn(m.tags ?? [], m.title) }));
    } catch (err) {
      errors.push(`${path}: ${(err as Error).message}`);
    }
  }
  if (errors.length) throw new Error(`Could not update ${errors.length} file(s).\n${errors.join('\n')}`);
}

export function setTitle(id: number, title: string): Promise<void> {
  return editEach([id], () => ({ title: title.trim() || undefined }));
}

export function addTag(ids: number[], tag: string): Promise<void> {
  const [t] = normalizeTags([tag]);
  if (!t) return Promise.resolve();
  return editEach(ids, (tags) => ({ tags: normalizeTags([...tags, t]) }));
}

export function removeTag(ids: number[], tag: string): Promise<void> {
  const key = tag.toLowerCase();
  return editEach(ids, (tags) => ({ tags: tags.filter((x) => x.toLowerCase() !== key) }));
}

/** Move to the OS trash (recoverable), after confirming. Returns how many were trashed. */
export async function trash(ids: number[], parent?: BrowserWindow): Promise<number> {
  const paths = lib().pathsFor(ids);
  if (!paths.length) return 0;
  const opts = {
    type: 'warning' as const,
    buttons: ['Move to Trash', 'Cancel'],
    defaultId: 0,
    cancelId: 1,
    message: paths.length === 1 ? 'Move this capture to the Trash?' : `Move ${paths.length} captures to the Trash?`,
    detail: 'You can restore them from the system Trash.',
  };
  const { response } = parent ? await dialog.showMessageBox(parent, opts) : await dialog.showMessageBox(opts);
  if (response !== 0) return 0;

  const done: string[] = [];
  for (const p of paths) {
    closeEditorsForPath(p); // an open editor would otherwise autosave it back into existence
    try {
      await shell.trashItem(p);
      done.push(p);
    } catch (err) {
      console.warn('[library] trash failed', p, err);
    }
  }
  lib().removePaths(done);
  broadcastChanged();
  return done.length;
}

export function reveal(id: number): void {
  const [p] = lib().pathsFor([id]);
  if (p) shell.showItemInFolder(p);
}

export function closeLibrary(): void {
  watcher?.close();
  db?.close();
  db = null;
}
