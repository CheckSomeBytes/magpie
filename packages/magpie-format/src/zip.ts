import { strFromU8, strToU8, unzipSync, zipSync, type Zippable } from 'fflate';
import { FormatError, migrate } from './migrate';
import type { MagpieProject } from './schema';

const MANIFEST = 'manifest.json';
const ORIGINAL = 'original.png';
const ANNOTATIONS = 'annotations.json';

/** Serialize a project to .magpie (zip) bytes. */
export function packProject(project: MagpieProject): Uint8Array {
  const manifest = { ...project.manifest, thumb: project.thumb ? project.manifest.thumb ?? 'thumb.webp' : null };
  const files: Zippable = {
    [MANIFEST]: strToU8(JSON.stringify(manifest, null, 2)),
    // PNG and WebP are already compressed; store them.
    [ORIGINAL]: [project.original, { level: 0 }],
    [ANNOTATIONS]: strToU8(JSON.stringify(project.doc)),
  };
  if (project.thumb && manifest.thumb) files[manifest.thumb] = [project.thumb, { level: 0 }];
  return zipSync(files, { level: 6 });
}

/** Parse .magpie bytes, migrating older versions forward. */
export function unpackProject(bytes: Uint8Array): MagpieProject {
  let entries: Record<string, Uint8Array>;
  try {
    entries = unzipSync(bytes);
  } catch (err) {
    throw new FormatError(`Not a readable zip: ${(err as Error).message}`);
  }
  const need = (name: string): Uint8Array => {
    const e = entries[name];
    if (!e) throw new FormatError(`Missing ${name}.`);
    return e;
  };
  const parse = (name: string): unknown => {
    try {
      return JSON.parse(strFromU8(need(name)));
    } catch (err) {
      if (err instanceof FormatError) throw err;
      throw new FormatError(`${name} is not valid JSON.`);
    }
  };

  const { manifest, doc } = migrate(parse(MANIFEST), parse(ANNOTATIONS));
  const thumb = manifest.thumb ? entries[manifest.thumb] ?? null : null;
  return { manifest, doc, original: need(ORIGINAL), thumb };
}

/** Read only the manifest and thumbnail (for library listings). */
export function peekProject(bytes: Uint8Array): Pick<MagpieProject, 'manifest' | 'thumb'> {
  const entries = unzipSync(bytes, {
    filter: (f) => f.name === MANIFEST || f.name === ANNOTATIONS || f.name.startsWith('thumb.'),
  });
  const m = entries[MANIFEST];
  const a = entries[ANNOTATIONS];
  if (!m || !a) throw new FormatError('Missing manifest.json or annotations.json.');
  const { manifest } = migrate(JSON.parse(strFromU8(m)), JSON.parse(strFromU8(a)));
  return { manifest, thumb: manifest.thumb ? entries[manifest.thumb] ?? null : null };
}
