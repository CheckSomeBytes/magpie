/**
 * Style presets and annotation templates (Phase 4). Kept in localStorage, which
 * every editor window shares (same origin). Reads and writes never throw.
 */
import { useSyncExternalStore } from 'react';
import type { Annotation, AnnotationType, Style } from '@magpie/format';
import type { BlurPrefs } from './tools';

export interface StylePreset {
  id: string;
  name: string;
  type: AnnotationType;
  style: Style;
  blur?: BlurPrefs;
}

/** Positions are stored as fractions of the image so templates fit any capture size. */
export interface Template {
  id: string;
  name: string;
  annotations: Array<Annotation & { rx: number; ry: number }>;
}

const KEYS = { presets: 'magpie.stylePresets.v1', templates: 'magpie.templates.v1' } as const;
const listeners = new Set<() => void>();
const cache = new Map<string, unknown>();

function read<T>(key: string): T[] {
  if (cache.has(key)) return cache.get(key) as T[];
  let v: T[] = [];
  try {
    const raw = JSON.parse(localStorage.getItem(key) ?? '[]') as unknown;
    if (Array.isArray(raw)) v = raw as T[];
  } catch {
    /* storage unavailable or corrupt */
  }
  cache.set(key, v);
  return v;
}

function write<T>(key: string, v: T[]): void {
  cache.set(key, v);
  try {
    localStorage.setItem(key, JSON.stringify(v));
  } catch {
    /* quota or unavailable: keep in memory for this window */
  }
  listeners.forEach((l) => l());
}

// Another editor window changed them.
window.addEventListener('storage', (e) => {
  if (e.key === KEYS.presets || e.key === KEYS.templates) {
    cache.delete(e.key);
    listeners.forEach((l) => l());
  }
});

function subscribe(l: () => void): () => void {
  listeners.add(l);
  return () => listeners.delete(l);
}

export function useStylePresets(): StylePreset[] {
  return useSyncExternalStore(subscribe, () => read<StylePreset>(KEYS.presets));
}

export function useTemplates(): Template[] {
  return useSyncExternalStore(subscribe, () => read<Template>(KEYS.templates));
}

export function saveStylePreset(p: Omit<StylePreset, 'id'>): void {
  write(KEYS.presets, [...read<StylePreset>(KEYS.presets), { ...p, id: crypto.randomUUID() }]);
}

export function deleteStylePreset(id: string): void {
  write(KEYS.presets, read<StylePreset>(KEYS.presets).filter((p) => p.id !== id));
}

/** Image annotations are left out: their pixels live in the project file, not in a template. */
export function saveTemplate(name: string, annotations: Annotation[], imageW: number, imageH: number): number {
  const kept = annotations
    .filter((a) => a.type !== 'image')
    .map((a) => ({ ...a, rx: a.x / imageW, ry: a.y / imageH }));
  write(KEYS.templates, [...read<Template>(KEYS.templates), { id: crypto.randomUUID(), name, annotations: kept }]);
  return kept.length;
}

export function deleteTemplate(id: string): void {
  write(KEYS.templates, read<Template>(KEYS.templates).filter((t) => t.id !== id));
}

/** Instantiate a template for an image of the given size (fresh ids, positions scaled). */
export function instantiateTemplate(t: Template, imageW: number, imageH: number): Annotation[] {
  return t.annotations.map(({ rx, ry, ...a }) => ({
    ...(a as Annotation),
    id: crypto.randomUUID(),
    x: Math.round(rx * imageW),
    y: Math.round(ry * imageH),
  }));
}
