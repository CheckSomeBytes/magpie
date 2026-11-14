import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { FORMAT_VERSION, emptyDoc, packProject } from '@magpie/format';
import { exportVideo, ffmpegPath, probe, remux, run, thumbnail } from '../src/main/media/ffmpeg';
import { isVideoFile, readMeta, sidecarPath, videoForSidecar, writeMeta } from '../src/main/media/sidecar';
import { LibraryDb } from '../src/main/library/db';
import { libraryPathFor, syncFolder, syncPaths } from '../src/main/library/indexer';

const hasFfmpeg = !!ffmpegPath();
let dir: string;
let clip: string;

beforeAll(async () => {
  dir = mkdtempSync(join(tmpdir(), 'magpie-media-'));
  clip = join(dir, 'clip.webm');
  if (hasFfmpeg) {
    // 2 s, 320×240, VP9 + Opus test pattern: stands in for a MediaRecorder file.
    await run(['-y', '-f', 'lavfi', '-i', 'testsrc=size=320x240:rate=15:duration=2', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=2', '-c:v', 'libvpx-vp9', '-deadline', 'realtime', '-cpu-used', '8', '-c:a', 'libopus', '-shortest', clip]);
  }
}, 60_000);

afterAll(() => rmSync(dir, { recursive: true, force: true }));

describe.skipIf(!hasFfmpeg)('ffmpeg helpers', () => {
  it('probes duration, size and audio', async () => {
    const p = await probe(clip);
    expect(p.width).toBe(320);
    expect(p.height).toBe(240);
    expect(p.hasAudio).toBe(true);
    expect(p.duration).toBeGreaterThan(1.8);
    expect(p.duration).toBeLessThan(2.3);
  });

  it('extracts a PNG thumbnail', async () => {
    const png = await thumbnail(clip, 0.5, 160);
    expect([...png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
  });

  it('remuxes without re-encoding', async () => {
    const out = join(dir, 'remuxed.webm');
    await remux(clip, out);
    expect((await probe(out)).width).toBe(320);
  });

  it('exports a trimmed MP4, GIF and WebM with progress', async () => {
    const seen: number[] = [];
    const mp4 = join(dir, 'out.mp4');
    await exportVideo(clip, mp4, { kind: 'mp4', start: 0.5, end: 1.5, onProgress: (f) => seen.push(f) });
    const p = await probe(mp4);
    expect(p.duration).toBeGreaterThan(0.85);
    expect(p.duration).toBeLessThan(1.2);
    expect(seen.at(-1)).toBe(1);

    const gif = join(dir, 'out.gif');
    await exportVideo(clip, gif, { kind: 'gif', start: 0, end: 1, gifWidth: 160, gifFps: 10 });
    expect(readFileSync(gif).subarray(0, 6).toString('ascii')).toBe('GIF89a');

    const webm = join(dir, 'trim.webm');
    await exportVideo(clip, webm, { kind: 'webm', start: 1, end: 2 });
    expect((await probe(webm)).duration).toBeLessThan(1.3);
  }, 60_000);

  it('reports unreadable files clearly', async () => {
    const bad = join(dir, 'bad.webm');
    writeFileSync(bad, 'nope');
    await expect(probe(bad)).rejects.toThrow(/Not a readable video/);
  });
});

describe('sidecars', () => {
  it('maps and round-trips video metadata', async () => {
    expect(isVideoFile('a/B.MP4')).toBe(true);
    expect(videoForSidecar('/x/clip.webm.json')).toBe('/x/clip.webm');
    expect(videoForSidecar('/x/settings.json')).toBeNull();
    expect(libraryPathFor('/x/clip.webm.json')).toBe('/x/clip.webm');
    expect(libraryPathFor('/x/a.magpie')).toBe('/x/a.magpie');
    expect(libraryPathFor('/x/a.magpie.tmp-1')).toBeNull();
    const v = join(dir, 'meta.webm');
    writeFileSync(v, '');
    await writeMeta(v, { title: '  Demo ', tags: ['ui', 'UI', ' release '] });
    expect(await readMeta(v)).toEqual({ title: 'Demo', tags: ['ui', 'release'] });
    expect(existsSync(sidecarPath(v))).toBe(true);
  });
});

describe.skipIf(!hasFfmpeg)('library indexes videos', () => {
  it('indexes videos next to projects; sidecar edits re-index; OCR skips videos', async () => {
    const root = mkdtempSync(join(tmpdir(), 'magpie-lib-video-'));
    writeFileSync(join(root, 'rec.webm'), readFileSync(clip));
    await writeMeta(join(root, 'rec.webm'), { tags: ['demo'] });
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    writeFileSync(
      join(root, 'shot.magpie'),
      packProject({
        manifest: { format: 'magpie', version: FORMAT_VERSION, app: { name: 'M', version: '0' }, created: '2026-11-13T00:00:00Z', modified: '2026-11-13T00:00:00Z', os: { platform: 'linux', release: 'x' }, image: { widthPx: 10, heightPx: 10 }, source: 'import', displays: [], thumb: null },
        original: png,
        doc: emptyDoc(),
        thumb: null,
      }),
    );
    const db = new LibraryDb(':memory:');
    const r = await syncFolder(db, root);
    expect(r.added).toBe(2);
    const vids = db.query({ tags: ['demo'] }).items;
    expect(vids).toHaveLength(1);
    expect(vids[0]!.kind).toBe('video');
    expect(vids[0]!.duration).toBeGreaterThan(1.8);
    expect(vids[0]!.thumbUrl).not.toBeNull();
    expect(db.needsOcr(10).map((x) => x.path)).toEqual([join(root, 'shot.magpie')]);

    // Retitle via the sidecar → stamp changes → re-indexed.
    await writeMeta(join(root, 'rec.webm'), { title: 'Release walkthrough', tags: ['demo'] });
    const later = new Date(Date.now() + 5000);
    utimesSync(sidecarPath(join(root, 'rec.webm')), later, later);
    await syncPaths(db, [sidecarPath(join(root, 'rec.webm'))]);
    expect(db.query({ text: 'walkthrough' }).items[0]?.title).toBe('Release walkthrough');
    db.close();
    rmSync(root, { recursive: true, force: true });
  }, 60_000);
});

describe('schema migration', () => {
  it('upgrades a v1 index to v2 in place', () => {
    const file = join(dir, 'v1.sqlite');
    // Build a genuine v1 database using the v1 creator.
    const proto = Object.create(LibraryDb.prototype) as { db: DatabaseSync; createV1(): void };
    proto.db = new DatabaseSync(file);
    proto.createV1();
    proto.db.exec("INSERT INTO captures (path, created_at, modified_at, file_mtime, file_size, indexed_at) VALUES ('/a.magpie', '2026-01-01', '2026-01-01', 1, 1, 'now')");
    proto.db.close();

    const db = new LibraryDb(file);
    const items = db.query({}).items;
    expect(items).toHaveLength(1);
    expect(items[0]!.kind).toBe('image');
    expect((db.db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(2);
    db.close();
  });
});
