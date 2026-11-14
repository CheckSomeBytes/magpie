import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { mkdtempSync, mkdirSync, rmSync, unlinkSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { FORMAT_VERSION, emptyDoc, packProject, type Annotation, type Manifest } from '@magpie/format';
import { LibraryDb, displayTitle, ftsQuery } from '../src/main/library/db';
import { syncFolder, syncPaths } from '../src/main/library/indexer';
import { dayLabel, groupByDay } from '../src/renderer/library/group';

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0]);

function manifest(over: Partial<Manifest> = {}): Manifest {
  return {
    format: 'magpie',
    version: FORMAT_VERSION,
    app: { name: 'Magpie', version: 'test' },
    created: '2026-11-13T10:00:00.000Z',
    modified: '2026-11-13T10:00:00.000Z',
    os: { platform: 'linux', release: 'x' },
    image: { widthPx: 800, heightPx: 600 },
    source: 'portal',
    displays: [],
    thumb: 'thumb.png',
    ...over,
  };
}

function text(t: string): Annotation {
  return { id: t, type: 'text', x: 0, y: 0, rotation: 0, style: { stroke: '#000', strokeWidth: 0 }, data: { text: t, width: 100 } };
}

let root: string;
let db: LibraryDb;

function write(rel: string, m: Partial<Manifest> = {}, annotations: Annotation[] = []): string {
  const p = join(root, rel);
  mkdirSync(join(p, '..'), { recursive: true });
  writeFileSync(p, packProject({ manifest: manifest(m), original: PNG, doc: { ...emptyDoc(), annotations }, thumb: PNG }));
  return p;
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), 'magpie-lib-'));
  db = new LibraryDb(':memory:');
});
afterEach(() => {
  db.close();
  rmSync(root, { recursive: true, force: true });
});

describe('ftsQuery', () => {
  it('quotes tokens as prefix terms and neutralises operators', () => {
    expect(ftsQuery('login  page')).toBe('"login"* "page"*');
    expect(ftsQuery('a"b OR (c)*')).toBe('"ab"* "OR"* "c"*');
    expect(ftsQuery('   ')).toBeNull();
  });
});

describe('displayTitle', () => {
  it('falls back to the file name', () => {
    expect(displayTitle('/x/Magpie 2026-11-13 10.00.00.magpie', null)).toBe('Magpie 2026-11-13 10.00.00');
    expect(displayTitle('/x/a.magpie', '  Bug report ')).toBe('Bug report');
  });
});

describe('syncFolder', () => {
  it('indexes nested files, then detects changes and deletions', async () => {
    const a = write('2026/11/a.magpie', { title: 'Checkout bug', tags: ['bug', 'web'] });
    write('2026/10/b.magpie', { created: '2026-10-01T09:00:00.000Z' }, [text('Login button misaligned')]);
    writeFileSync(join(root, 'notes.txt'), 'ignored');

    let r = await syncFolder(db, root);
    expect(r).toMatchObject({ added: 2, updated: 0, removed: 0 });
    expect(db.query({}).total).toBe(2);

    // Unchanged → nothing re-read.
    r = await syncFolder(db, root);
    expect(r).toMatchObject({ added: 0, updated: 0, removed: 0 });

    // Change a file (bump mtime too, since writes in the same ms keep it).
    write('2026/11/a.magpie', { title: 'Checkout bug v2', tags: ['bug'] });
    const later = new Date(Date.now() + 5000);
    utimesSync(a, later, later);
    r = await syncFolder(db, root);
    expect(r.updated).toBe(1);
    expect(db.query({ text: 'v2' }).items[0]?.title).toBe('Checkout bug v2');
    expect(db.tags()).toEqual([{ name: 'bug', count: 1 }]); // "web" pruned

    unlinkSync(a);
    r = await syncFolder(db, root);
    expect(r.removed).toBe(1);
    expect(db.query({}).total).toBe(1);
  });

  it('reports unreadable files without failing the scan', async () => {
    write('ok.magpie');
    writeFileSync(join(root, 'broken.magpie'), 'not a zip');
    const r = await syncFolder(db, root);
    expect(r.added).toBe(1);
    expect(r.failed).toHaveLength(1);
  });
});

describe('query', () => {
  beforeEach(async () => {
    write('one.magpie', { title: 'Grafana dashboard', tags: ['ops', 'Metrics'], created: '2026-11-13T09:00:00.000Z' });
    write('two.magpie', { tags: ['ops'], created: '2026-11-12T09:00:00.000Z' }, [text('Disk full alert')]);
    write('three.magpie', { created: '2026-11-11T09:00:00.000Z' });
    await syncFolder(db, root);
  });

  it('searches titles, annotation text, file names and tags with prefix matching', () => {
    expect(db.query({ text: 'grafa' }).items.map((i) => i.title)).toEqual(['Grafana dashboard']);
    expect(db.query({ text: 'disk alert' }).total).toBe(1);
    expect(db.query({ text: 'three' }).total).toBe(1);
    expect(db.query({ text: 'metrics' }).total).toBe(1);
    expect(db.query({ text: 'nothing-like-this' }).total).toBe(0);
  });

  it('filters by tags (AND, case-insensitive) and untagged', () => {
    expect(db.query({ tags: ['ops'] }).total).toBe(2);
    expect(db.query({ tags: ['OPS', 'metrics'] }).total).toBe(1);
    expect(db.query({ untagged: true }).items.map((i) => i.title)).toEqual(['three']);
    expect(db.counts()).toEqual({ all: 3, untagged: 1 });
  });

  it('sorts and pages', () => {
    expect(db.query({ sort: 'oldest' }).items[0]!.title).toBe('three');
    const page = db.query({ limit: 2, offset: 2 });
    expect(page.total).toBe(3);
    expect(page.items).toHaveLength(1);
  });

  it('serves thumbnails and tag counts', () => {
    const item = db.query({ text: 'grafana' }).items[0]!;
    expect(item.thumbUrl).toMatch(/^magpie-thumb:\/\/t\/\d+\?v=\d+$/);
    expect(db.thumb(item.id)?.mime).toBe('image/png');
    expect(db.tags()).toEqual([
      { name: 'Metrics', count: 1 },
      { name: 'ops', count: 2 },
    ]);
  });

  it('makes OCR text searchable and keeps it across re-index', async () => {
    const item = db.query({ text: 'grafana' }).items[0]!;
    db.setOcrText(item.id, 'CPU usage 93%');
    expect(db.query({ text: 'cpu usage' }).total).toBe(1);
    // Re-index the file from disk (record has ocrText: null): OCR text must survive.
    const { readRecord } = await import('../src/main/library/indexer');
    const { statSync } = await import('node:fs');
    const st = statSync(item.path);
    db.upsert(await readRecord({ path: item.path, mtime: st.mtimeMs, size: st.size }));
    expect(db.query({ text: 'cpu' }).total).toBe(1);
  });
});

describe('syncPaths', () => {
  it('adds new files and removes missing ones', async () => {
    const p = write('new.magpie');
    let r = await syncPaths(db, [p]);
    expect(r.added).toBe(1);
    unlinkSync(p);
    r = await syncPaths(db, [p]);
    expect(r.removed).toBe(1);
  });
});

describe('day grouping', () => {
  const now = new Date(2026, 10, 13, 15, 0);
  it('labels days', () => {
    expect(dayLabel(new Date(2026, 10, 13, 8), now)).toBe('Today');
    expect(dayLabel(new Date(2026, 10, 12, 23), now)).toBe('Yesterday');
    expect(dayLabel(new Date(2026, 10, 10), now)).toMatch(/day$/);
    expect(dayLabel(new Date(2025, 0, 2), now)).toMatch(/2025/);
  });
  it('groups consecutive items by day', () => {
    const mk = (id: number, d: Date) => ({ id, createdAt: d.toISOString() }) as never;
    const g = groupByDay([mk(1, new Date(2026, 10, 13, 9)), mk(2, new Date(2026, 10, 13, 8)), mk(3, new Date(2026, 10, 12, 9))], 'newest', now);
    expect(g.map((x) => [x.label, x.items.length])).toEqual([
      ['Today', 2],
      ['Yesterday', 1],
    ]);
  });
});
