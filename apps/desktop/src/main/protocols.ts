/**
 * Custom schemes. Electron wants ONE registerSchemesAsPrivileged() call,
 * before 'ready', listing every scheme.
 *   magpie-thumb://t/<id>     library thumbnails (library/service.ts)
 *   magpie-asset://ocr/...    bundled OCR worker, cores and language data
 */
import { app, protocol } from 'electron';
import { createReadStream } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import { Readable } from 'node:stream';
import { randomUUID } from 'node:crypto';
import { extname, join, normalize, sep } from 'node:path';

export const THUMB_SCHEME = 'magpie-thumb';
export const ASSET_SCHEME = 'magpie-asset';
export const MEDIA_SCHEME = 'magpie-media';

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // corsEnabled: the OCR worker runs from a blob: URL and fetches/imports these cross-origin.
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
    // stream: lets <video> issue Range requests and seek.
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true } },
  ]);
}

const ROOTS: Record<string, string[]> = { ocr: ['resources', 'ocr'] };
const TYPES: Record<string, string> = { '.js': 'text/javascript', '.wasm': 'application/wasm', '.gz': 'application/octet-stream' };

export function registerAssetProtocol(): void {
  protocol.handle(ASSET_SCHEME, async (req) => {
    const url = new URL(req.url);
    const root = ROOTS[url.hostname];
    if (!root) return new Response(null, { status: 404 });
    const base = join(app.getAppPath(), ...root);
    const file = normalize(join(base, decodeURIComponent(url.pathname)));
    if (!file.startsWith(base + sep)) return new Response(null, { status: 403 }); // no traversal
    try {
      const body = await readFile(file);
      return new Response(new Uint8Array(body), {
        headers: {
          'content-type': TYPES[extname(file)] ?? 'application/octet-stream',
          'access-control-allow-origin': '*',
          'cache-control': 'max-age=31536000',
        },
      });
    } catch {
      return new Response(null, { status: 404 });
    }
  });
}

/**
 * magpie-media://v/<token>: serves ONLY files registered via mediaUrl(), never
 * arbitrary paths. Supports Range so the player can seek.
 */
const media = new Map<string, string>();

export function mediaUrl(path: string): string {
  for (const [t, p] of media) if (p === path) return `${MEDIA_SCHEME}://v/${t}`;
  const token = randomUUID();
  media.set(token, path);
  return `${MEDIA_SCHEME}://v/${token}`;
}

export function forgetMedia(path: string): void {
  for (const [t, p] of media) if (p === path) media.delete(t);
}

const MEDIA_TYPES: Record<string, string> = { '.webm': 'video/webm', '.mp4': 'video/mp4', '.gif': 'image/gif' };

export function registerMediaProtocol(): void {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const file = media.get(new URL(req.url).pathname.replace(/^\//, ''));
    if (!file) return new Response(null, { status: 404 });
    let size: number;
    try {
      size = (await stat(file)).size;
    } catch {
      return new Response(null, { status: 404 });
    }
    const type = MEDIA_TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream';
    const range = /bytes=(\d*)-(\d*)/.exec(req.headers.get('range') ?? '');
    if (range && (range[1] || range[2])) {
      let start = range[1] ? Number(range[1]) : size - Number(range[2]);
      let end = range[1] && range[2] ? Number(range[2]) : size - 1;
      start = Math.max(0, Math.min(start, size - 1));
      end = Math.max(start, Math.min(end, size - 1));
      const body = Readable.toWeb(createReadStream(file, { start, end })) as unknown as ReadableStream;
      return new Response(body, {
        status: 206,
        headers: { 'content-type': type, 'content-length': String(end - start + 1), 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes' },
      });
    }
    const body = Readable.toWeb(createReadStream(file)) as unknown as ReadableStream;
    return new Response(body, { headers: { 'content-type': type, 'content-length': String(size), 'accept-ranges': 'bytes' } });
  });
}
