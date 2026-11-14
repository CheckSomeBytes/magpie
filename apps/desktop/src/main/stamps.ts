/** Custom stamp library (Phase 4): PNGs in <userData>/stamps with a small index. */
import { app, dialog, nativeImage, type BrowserWindow } from 'electron';
import { randomUUID } from 'node:crypto';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { basename, extname, join } from 'node:path';
import type { CustomStamp } from '../shared/ipc';

interface Entry {
  id: string;
  name: string;
}

const dir = () => join(app.getPath('userData'), 'stamps');
const indexFile = () => join(dir(), 'index.json');
const MAX_SIDE = 512;

async function readIndex(): Promise<Entry[]> {
  try {
    const raw = JSON.parse(await readFile(indexFile(), 'utf8')) as Entry[];
    return Array.isArray(raw) ? raw.filter((e) => /^[A-Za-z0-9-]+$/.test(e.id)) : [];
  } catch {
    return [];
  }
}

async function writeIndex(entries: Entry[]): Promise<void> {
  await mkdir(dir(), { recursive: true });
  await writeFile(indexFile(), JSON.stringify(entries, null, 2));
}

export async function listStamps(): Promise<CustomStamp[]> {
  const out: CustomStamp[] = [];
  for (const e of await readIndex()) {
    try {
      out.push({ ...e, png: new Uint8Array(await readFile(join(dir(), `${e.id}.png`))) });
    } catch {
      /* missing file: skip */
    }
  }
  return out;
}

/** Normalise any image to a PNG no larger than MAX_SIDE. */
function toStampPng(bytes: Buffer): Buffer {
  let img = nativeImage.createFromBuffer(bytes);
  if (img.isEmpty()) throw new Error('That file is not an image Magpie can read (PNG or JPEG).');
  const { width, height } = img.getSize();
  if (Math.max(width, height) > MAX_SIDE) {
    img = width >= height ? img.resize({ width: MAX_SIDE, quality: 'best' }) : img.resize({ height: MAX_SIDE, quality: 'best' });
  }
  return img.toPNG();
}

export async function saveStamp(name: string, png: Uint8Array): Promise<CustomStamp> {
  const id = randomUUID();
  const data = toStampPng(Buffer.from(png));
  await mkdir(dir(), { recursive: true });
  await writeFile(join(dir(), `${id}.png`), data);
  const entries = await readIndex();
  const entry = { id, name: name.trim().slice(0, 60) || 'Stamp' };
  await writeIndex([...entries, entry]);
  return { ...entry, png: new Uint8Array(data) };
}

export async function importStamp(parent?: BrowserWindow): Promise<CustomStamp | null> {
  const opts = { title: 'Add a stamp image', filters: [{ name: 'Images', extensions: ['png', 'jpg', 'jpeg'] }], properties: ['openFile' as const] };
  const res = parent ? await dialog.showOpenDialog(parent, opts) : await dialog.showOpenDialog(opts);
  const file = res.filePaths[0];
  if (res.canceled || !file) return null;
  return saveStamp(basename(file, extname(file)), await readFile(file));
}

export async function deleteStamp(id: string): Promise<void> {
  const entries = await readIndex();
  if (!entries.some((e) => e.id === id)) return;
  await writeIndex(entries.filter((e) => e.id !== id));
  await rm(join(dir(), `${id}.png`), { force: true });
}
