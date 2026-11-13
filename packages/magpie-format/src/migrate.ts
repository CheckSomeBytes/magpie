import { FORMAT_ID, FORMAT_VERSION, type AnnotationDoc, type Manifest } from './schema';

export class FormatError extends Error {
  override name = 'FormatError';
}

/**
 * A migration lifts a raw (manifest, doc) pair from version N to N+1.
 * Register one per version bump; `migrate` chains them.
 *
 *   MIGRATIONS[1] = (m, d) => ({ manifest: {...m, version: 2}, doc: {...d, version: 2, ...} })
 */
type Raw = { manifest: Record<string, unknown>; doc: Record<string, unknown> };
export type Migration = (raw: Raw) => Raw;

export const MIGRATIONS: Record<number, Migration> = {};

export function migrate(
  manifestIn: unknown,
  docIn: unknown,
  migrations: Record<number, Migration> = MIGRATIONS,
  target: number = FORMAT_VERSION,
): { manifest: Manifest; doc: AnnotationDoc } {
  if (!isObject(manifestIn) || manifestIn.format !== FORMAT_ID) {
    throw new FormatError('Not a Magpie file (manifest.format is missing or wrong).');
  }
  if (!isObject(docIn)) throw new FormatError('annotations.json is not an object.');

  let raw: Raw = { manifest: manifestIn, doc: docIn };
  let version = Number(raw.manifest.version);
  if (!Number.isInteger(version) || version < 1) {
    throw new FormatError(`Invalid file version: ${String(raw.manifest.version)}`);
  }
  if (version > target) {
    throw new FormatError(
      `This file was made by a newer Magpie (format v${version}; this build reads up to v${target}).`,
    );
  }
  while (version < target) {
    const step = migrations[version];
    if (!step) throw new FormatError(`No migration from format v${version}.`);
    raw = step(raw);
    version += 1;
    raw.manifest.version = version;
    raw.doc.version = version;
  }

  const doc = raw.doc as unknown as AnnotationDoc;
  if (!Array.isArray(doc.annotations)) throw new FormatError('annotations.json has no annotations array.');
  if (doc.crop === undefined) doc.crop = null;
  return { manifest: raw.manifest as unknown as Manifest, doc };
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}
