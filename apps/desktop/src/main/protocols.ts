/**
 * Custom schemes. Electron wants ONE registerSchemesAsPrivileged() call,
 * before 'ready', listing every scheme.
 *   magpie-thumb://t/<id>     library thumbnails (library/service.ts)
 *   magpie-asset://ocr/...    bundled OCR worker, cores and language data
 */
import { app, protocol } from 'electron';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize, sep } from 'node:path';

export const THUMB_SCHEME = 'magpie-thumb';
export const ASSET_SCHEME = 'magpie-asset';

export function registerPrivilegedSchemes(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: THUMB_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } },
    // corsEnabled: the OCR worker runs from a blob: URL and fetches/imports these cross-origin.
    { scheme: ASSET_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
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
