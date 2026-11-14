/**
 * Library index (§9). node:sqlite (bundled with Electron's Node, so no native
 * rebuild) + FTS5. This is a CACHE: titles and tags live in the .magpie
 * manifests, so deleting library.sqlite loses nothing.
 *
 * No Electron imports here, so it runs under plain Node in unit tests.
 */
import { DatabaseSync, type StatementSync } from 'node:sqlite';
import { basename } from 'node:path';
import type { LibraryItem, LibraryQuery, LibraryResult, TagCount } from '../../shared/ipc';

const SCHEMA_VERSION = 2;

export interface CaptureRecord {
  path: string;
  title: string | null;
  createdAt: string;
  modifiedAt: string;
  width: number;
  height: number;
  appHint: string | null;
  ocrText: string | null;
  annotationCount: number;
  annotationText: string;
  tags: string[];
  fileMtime: number;
  fileSize: number;
  thumb: Uint8Array | null;
  thumbMime: string | null;
  kind?: 'image' | 'video';
  /** Seconds, for videos. */
  duration?: number | null;
}

interface Row {
  id: number;
  path: string;
  title: string | null;
  created_at: string;
  modified_at: string;
  width: number;
  height: number;
  annotation_count: number;
  file_mtime: number;
  has_thumb: number;
  tags: string | null;
  kind: 'image' | 'video';
  duration: number | null;
}

const SEP = '\u001f';

export function displayTitle(path: string, title: string | null): string {
  return title?.trim() || basename(path).replace(/\.magpie$/i, '');
}

/**
 * Turn user input into a safe FTS5 query: every token is a quoted prefix
 * term, all ANDed. FTS operators typed by the user are treated as text.
 */
export function ftsQuery(text: string): string | null {
  const tokens = text
    .split(/\s+/)
    .map((t) => t.replace(/["*^:(){}\[\]]/g, '').trim())
    .filter(Boolean);
  if (!tokens.length) return null;
  return tokens.map((t) => `"${t.replace(/"/g, '""')}"*`).join(' ');
}

export class LibraryDb {
  readonly db: DatabaseSync;
  private stmts: Record<string, StatementSync> = {};

  constructor(file: string) {
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA synchronous = NORMAL;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    const { user_version: v } = this.db.prepare('PRAGMA user_version').get() as { user_version: number };
    if (v >= SCHEMA_VERSION) return;
    if (v < 1) this.createV1();
    if (v < 2) {
      // Phase 5: videos in the library.
      this.db.exec(`
        BEGIN;
        ALTER TABLE captures ADD COLUMN kind TEXT NOT NULL DEFAULT 'image';
        ALTER TABLE captures ADD COLUMN duration REAL;
        PRAGMA user_version = 2;
        COMMIT;
      `);
    }
  }

  private createV1(): void {
    this.db.exec(`
      BEGIN;
      CREATE TABLE IF NOT EXISTS captures (
        id INTEGER PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        title TEXT,
        created_at TEXT NOT NULL,
        modified_at TEXT NOT NULL,
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        app_hint TEXT,
        ocr_text TEXT,
        annotation_count INTEGER NOT NULL DEFAULT 0,
        annotation_text TEXT NOT NULL DEFAULT '',
        file_mtime REAL NOT NULL,
        file_size INTEGER NOT NULL,
        thumb BLOB,
        thumb_mime TEXT,
        indexed_at TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS captures_created ON captures(created_at);
      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL UNIQUE COLLATE NOCASE
      );
      CREATE TABLE IF NOT EXISTS capture_tags (
        capture_id INTEGER NOT NULL REFERENCES captures(id) ON DELETE CASCADE,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (capture_id, tag_id)
      );
      CREATE INDEX IF NOT EXISTS capture_tags_tag ON capture_tags(tag_id);
      CREATE VIRTUAL TABLE IF NOT EXISTS captures_fts USING fts5(
        title, body, tags, tokenize = 'unicode61 remove_diacritics 2'
      );
      PRAGMA user_version = 1;
      COMMIT;
    `);
  }

  private stmt(sql: string): StatementSync {
    return (this.stmts[sql] ??= this.db.prepare(sql));
  }

  private tx<T>(fn: () => T): T {
    this.db.exec('BEGIN');
    try {
      const r = fn();
      this.db.exec('COMMIT');
      return r;
    } catch (err) {
      this.db.exec('ROLLBACK');
      throw err;
    }
  }

  /** mtime/size of every indexed file, for change detection. */
  fileStamps(): Map<string, { mtime: number; size: number }> {
    const rows = this.stmt('SELECT path, file_mtime, file_size FROM captures').all() as Array<{ path: string; file_mtime: number; file_size: number }>;
    return new Map(rows.map((r) => [r.path, { mtime: r.file_mtime, size: r.file_size }]));
  }

  upsert(rec: CaptureRecord): number {
    return this.tx(() => {
      this.stmt(`
        INSERT INTO captures (path, title, created_at, modified_at, width, height, app_hint, ocr_text,
          annotation_count, annotation_text, file_mtime, file_size, thumb, thumb_mime, indexed_at, kind, duration)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(path) DO UPDATE SET
          title = excluded.title, created_at = excluded.created_at, modified_at = excluded.modified_at,
          width = excluded.width, height = excluded.height, app_hint = excluded.app_hint,
          ocr_text = COALESCE(excluded.ocr_text, captures.ocr_text),
          annotation_count = excluded.annotation_count, annotation_text = excluded.annotation_text,
          file_mtime = excluded.file_mtime, file_size = excluded.file_size,
          thumb = excluded.thumb, thumb_mime = excluded.thumb_mime, indexed_at = excluded.indexed_at,
          kind = excluded.kind, duration = excluded.duration
      `).run(
        rec.path,
        rec.title,
        rec.createdAt,
        rec.modifiedAt,
        rec.width,
        rec.height,
        rec.appHint,
        rec.ocrText,
        rec.annotationCount,
        rec.annotationText,
        rec.fileMtime,
        rec.fileSize,
        rec.thumb,
        rec.thumbMime,
        new Date().toISOString(),
        rec.kind ?? 'image',
        rec.duration ?? null,
      );
      const { id } = this.stmt('SELECT id FROM captures WHERE path = ?').get(rec.path) as { id: number };

      this.stmt('DELETE FROM capture_tags WHERE capture_id = ?').run(id);
      for (const name of rec.tags) {
        this.stmt('INSERT INTO tags (name) VALUES (?) ON CONFLICT(name) DO NOTHING').run(name);
        const tag = this.stmt('SELECT id FROM tags WHERE name = ?').get(name) as { id: number };
        this.stmt('INSERT OR IGNORE INTO capture_tags (capture_id, tag_id) VALUES (?, ?)').run(id, tag.id);
      }
      this.pruneTags();

      this.refreshFts(id);
      return id;
    });
  }

  removePaths(paths: Iterable<string>): number {
    let n = 0;
    this.tx(() => {
      for (const p of paths) {
        const row = this.stmt('SELECT id FROM captures WHERE path = ?').get(p) as { id: number } | undefined;
        if (!row) continue;
        this.stmt('DELETE FROM captures_fts WHERE rowid = ?').run(row.id);
        this.stmt('DELETE FROM captures WHERE id = ?').run(row.id);
        n++;
      }
      if (n) this.pruneTags();
    });
    return n;
  }

  private pruneTags(): void {
    this.stmt('DELETE FROM tags WHERE id NOT IN (SELECT DISTINCT tag_id FROM capture_tags)').run();
  }

  query(q: LibraryQuery): LibraryResult {
    const where: string[] = [];
    const params: Array<string | number> = [];
    const fts = q.text ? ftsQuery(q.text) : null;
    if (fts) {
      where.push('c.id IN (SELECT rowid FROM captures_fts WHERE captures_fts MATCH ?)');
      params.push(fts);
    }
    for (const tag of q.tags ?? []) {
      where.push('EXISTS (SELECT 1 FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id AND t.name = ?)');
      params.push(tag);
    }
    if (q.untagged) where.push('NOT EXISTS (SELECT 1 FROM capture_tags ct WHERE ct.capture_id = c.id)');
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const order = q.sort === 'oldest' ? 'c.created_at ASC, c.id ASC' : 'c.created_at DESC, c.id DESC';
    const limit = Math.max(1, Math.min(q.limit ?? 200, 5000));
    const offset = Math.max(0, q.offset ?? 0);

    const { n: total } = this.db.prepare(`SELECT COUNT(*) AS n FROM captures c ${whereSql}`).get(...params) as { n: number };
    const rows = this.db
      .prepare(
        `SELECT c.id, c.path, c.title, c.created_at, c.modified_at, c.width, c.height, c.annotation_count, c.file_mtime,
                c.thumb IS NOT NULL AS has_thumb, c.kind, c.duration,
                (SELECT group_concat(t.name, '${SEP}') FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id) AS tags
         FROM captures c ${whereSql} ORDER BY ${order} LIMIT ? OFFSET ?`,
      )
      .all(...params, limit, offset) as unknown as Row[];
    return { total, items: rows.map(toItem) };
  }

  get(id: number): LibraryItem | null {
    const row = this.db
      .prepare(
        `SELECT c.id, c.path, c.title, c.created_at, c.modified_at, c.width, c.height, c.annotation_count, c.file_mtime,
                c.thumb IS NOT NULL AS has_thumb, c.kind, c.duration,
                (SELECT group_concat(t.name, '${SEP}') FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id) AS tags
         FROM captures c WHERE c.id = ?`,
      )
      .get(id) as unknown as Row | undefined;
    return row ? toItem(row) : null;
  }

  pathsFor(ids: number[]): string[] {
    return ids
      .map((id) => (this.stmt('SELECT path FROM captures WHERE id = ?').get(id) as { path: string } | undefined)?.path)
      .filter((p): p is string => !!p);
  }

  tags(): TagCount[] {
    return this.stmt(
      `SELECT t.name AS name, COUNT(ct.capture_id) AS count FROM tags t
       JOIN capture_tags ct ON ct.tag_id = t.id GROUP BY t.id ORDER BY t.name COLLATE NOCASE`,
    ).all() as unknown as TagCount[];
  }

  counts(): { all: number; untagged: number } {
    const all = (this.stmt('SELECT COUNT(*) AS n FROM captures').get() as { n: number }).n;
    const untagged = (this.stmt('SELECT COUNT(*) AS n FROM captures c WHERE NOT EXISTS (SELECT 1 FROM capture_tags ct WHERE ct.capture_id = c.id)').get() as { n: number }).n;
    return { all, untagged };
  }

  thumb(id: number): { data: Uint8Array; mime: string } | null {
    const row = this.stmt('SELECT thumb, thumb_mime FROM captures WHERE id = ?').get(id) as { thumb: Uint8Array | null; thumb_mime: string | null } | undefined;
    if (!row?.thumb) return null;
    return { data: row.thumb, mime: row.thumb_mime ?? 'image/png' };
  }

  /** Captures not yet OCR'd (newest first). '' means "done, no text found". */
  needsOcr(limit: number): Array<{ id: number; path: string }> {
    return this.stmt("SELECT id, path FROM captures WHERE ocr_text IS NULL AND kind = 'image' ORDER BY created_at DESC LIMIT ?").all(limit) as Array<{ id: number; path: string }>;
  }

  ocrText(id: number): string | null {
    const r = this.stmt('SELECT ocr_text FROM captures WHERE id = ?').get(id) as { ocr_text: string | null } | undefined;
    return r?.ocr_text ?? null;
  }

  /** Phase 4 hook: OCR text survives re-indexing (upsert COALESCEs it). */
  setOcrText(id: number, text: string): void {
    this.tx(() => {
      this.stmt('UPDATE captures SET ocr_text = ? WHERE id = ?').run(text, id);
      this.refreshFts(id);
    });
  }

  /** Rebuild one row of the full-text index from the stored columns. */
  private refreshFts(id: number): void {
    const r = this.stmt(
      `SELECT c.path, c.title, c.annotation_text, c.ocr_text, c.app_hint,
              (SELECT group_concat(t.name, ' ') FROM capture_tags ct JOIN tags t ON t.id = ct.tag_id WHERE ct.capture_id = c.id) AS tags
       FROM captures c WHERE c.id = ?`,
    ).get(id) as { path: string; title: string | null; annotation_text: string; ocr_text: string | null; app_hint: string | null; tags: string | null } | undefined;
    this.stmt('DELETE FROM captures_fts WHERE rowid = ?').run(id);
    if (!r) return;
    const body = [basename(r.path), r.annotation_text, r.ocr_text ?? '', r.app_hint ?? ''].filter(Boolean).join('\n');
    this.stmt('INSERT INTO captures_fts (rowid, title, body, tags) VALUES (?, ?, ?, ?)').run(id, displayTitle(r.path, r.title), body, r.tags ?? '');
  }
}

function toItem(r: Row): LibraryItem {
  return {
    id: r.id,
    path: r.path,
    title: displayTitle(r.path, r.title),
    customTitle: !!r.title?.trim(),
    createdAt: r.created_at,
    modifiedAt: r.modified_at,
    width: r.width,
    height: r.height,
    annotationCount: r.annotation_count,
    tags: r.tags ? r.tags.split(SEP).sort((a, b) => a.localeCompare(b)) : [],
    thumbUrl: r.has_thumb ? `magpie-thumb://t/${r.id}?v=${Math.round(r.file_mtime)}` : null,
    kind: r.kind ?? 'image',
    duration: r.duration ?? null,
  };
}
