/**
 * Videos can't carry a manifest, so library title/tags live in a sidecar:
 * "<video>.json" next to the file. Pure Node.
 */
import { readFile, rename, stat, writeFile } from 'node:fs/promises';
import { normalizeTags } from '@magpie/format';

export interface VideoMeta {
  title?: string;
  tags?: string[];
}

export const VIDEO_EXTS = ['.webm', '.mp4'] as const;

export function isVideoFile(name: string): boolean {
  const n = name.toLowerCase();
  return VIDEO_EXTS.some((e) => n.endsWith(e));
}

export function sidecarPath(video: string): string {
  return `${video}.json`;
}

/** "clip.webm.json" → "clip.webm"; null for anything else. */
export function videoForSidecar(file: string): string | null {
  return file.toLowerCase().endsWith('.json') && isVideoFile(file.slice(0, -5)) ? file.slice(0, -5) : null;
}

export async function readMeta(video: string): Promise<VideoMeta> {
  try {
    const raw = JSON.parse(await readFile(sidecarPath(video), 'utf8')) as VideoMeta;
    return { title: typeof raw.title === 'string' ? raw.title : undefined, tags: Array.isArray(raw.tags) ? normalizeTags(raw.tags.map(String)) : undefined };
  } catch {
    return {};
  }
}

export async function writeMeta(video: string, meta: VideoMeta): Promise<void> {
  const clean: VideoMeta = {};
  if (meta.title?.trim()) clean.title = meta.title.trim();
  if (meta.tags?.length) clean.tags = normalizeTags(meta.tags);
  const tmp = `${sidecarPath(video)}.tmp-${process.pid}`;
  await writeFile(tmp, JSON.stringify(clean, null, 2));
  await rename(tmp, sidecarPath(video));
}

/** mtime/size covering the video and its sidecar, so a title/tag edit re-indexes. */
export async function videoStamp(video: string): Promise<{ mtime: number; size: number }> {
  const v = await stat(video);
  try {
    const s = await stat(sidecarPath(video));
    return { mtime: Math.max(v.mtimeMs, s.mtimeMs), size: v.size + s.size };
  } catch {
    return { mtime: v.mtimeMs, size: v.size };
  }
}
