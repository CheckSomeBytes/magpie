/**
 * Editor state. Undo/redo is a snapshot stack over our own serializable
 * annotation model (not Konva toJSON), capped at 200 (§7).
 */
import { create } from 'zustand';
import { renumberSteps, type Annotation, type AnnotationType, type Rect, type Style } from '@magpie/format';
import { DEFAULT_BLUR, DEFAULT_STYLES, type BlurPrefs, type Tool } from './tools';

const HISTORY_CAP = 200;
const PREFS_KEY = 'magpie.editor.prefs.v1';

interface Snapshot {
  annotations: Annotation[];
  crop: Rect | null;
}

interface Prefs {
  styles: Record<AnnotationType, Style>;
  blur: BlurPrefs;
}

function loadPrefs(): Prefs {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? 'null') as Partial<Prefs> | null;
    if (raw) return { styles: { ...DEFAULT_STYLES, ...raw.styles }, blur: { ...DEFAULT_BLUR, ...raw.blur } };
  } catch {
    /* storage unavailable */
  }
  return { styles: structuredClone(DEFAULT_STYLES), blur: { ...DEFAULT_BLUR } };
}

function savePrefs(p: Prefs): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* ignore */
  }
}

export interface EditorState extends Snapshot {
  tool: Tool;
  selectedId: string | null;
  editingTextId: string | null;
  styles: Record<AnnotationType, Style>;
  blur: BlurPrefs;
  past: Snapshot[];
  future: Snapshot[];
  /** Bumped on every model change; autosave watches it. */
  revision: number;

  load(s: Snapshot): void;
  setTool(t: Tool): void;
  select(id: string | null): void;
  setEditingText(id: string | null): void;

  /** Push the current state onto the undo stack (call before a live gesture). */
  checkpoint(): void;
  /** Throw away the most recent checkpoint (gesture produced nothing). */
  dropCheckpoint(): void;

  add(a: Annotation, opts?: { history?: boolean }): void;
  update(id: string, patch: Partial<Annotation> | ((a: Annotation) => Annotation), opts?: { history?: boolean }): void;
  remove(id: string, opts?: { history?: boolean }): void;
  reorder(id: string, dir: 'front' | 'back'): void;
  setCrop(crop: Rect | null, opts?: { history?: boolean }): void;
  undo(): void;
  redo(): void;

  setToolStyle(type: AnnotationType, patch: Partial<Style>): void;
  setBlurPrefs(patch: Partial<BlurPrefs>): void;
}

const prefs = loadPrefs();

export const useEditor = create<EditorState>()((set, get) => {
  const snap = (): Snapshot => ({ annotations: get().annotations, crop: get().crop });
  const pushPast = (s: Partial<EditorState>): Partial<EditorState> => ({
    ...s,
    past: [...get().past, snap()].slice(-HISTORY_CAP),
    future: [],
  });
  const commit = (next: Partial<EditorState>, history: boolean) => {
    const base = history ? pushPast(next) : next;
    set({ ...base, revision: get().revision + 1 });
  };

  return {
    annotations: [],
    crop: null,
    tool: 'arrow',
    selectedId: null,
    editingTextId: null,
    styles: prefs.styles,
    blur: prefs.blur,
    past: [],
    future: [],
    revision: 0,

    load: (s) => set({ annotations: s.annotations, crop: s.crop, past: [], future: [], selectedId: null, revision: 0 }),
    setTool: (tool) => set({ tool, editingTextId: null }),
    select: (selectedId) => set({ selectedId }),
    setEditingText: (editingTextId) => set({ editingTextId }),

    checkpoint: () => set({ past: [...get().past, snap()].slice(-HISTORY_CAP), future: [] }),
    dropCheckpoint: () => set({ past: get().past.slice(0, -1) }),

    add: (a, opts) => commit({ annotations: renumberSteps([...get().annotations, a]) }, opts?.history ?? true),

    update: (id, patch, opts) => {
      const annotations = get().annotations.map((a) => {
        if (a.id !== id) return a;
        return typeof patch === 'function' ? patch(a) : ({ ...a, ...patch } as Annotation);
      });
      commit({ annotations }, opts?.history ?? true);
    },

    remove: (id, opts) => {
      const annotations = renumberSteps(get().annotations.filter((a) => a.id !== id));
      commit({ annotations, selectedId: get().selectedId === id ? null : get().selectedId }, opts?.history ?? true);
    },

    reorder: (id, dir) => {
      const list = get().annotations;
      const a = list.find((x) => x.id === id);
      if (!a) return;
      const rest = list.filter((x) => x.id !== id);
      commit({ annotations: renumberSteps(dir === 'front' ? [...rest, a] : [a, ...rest]) }, true);
    },

    setCrop: (crop, opts) => commit({ crop }, opts?.history ?? true),

    undo: () => {
      const { past, future } = get();
      const prev = past[past.length - 1];
      if (!prev) return;
      set({
        ...prev,
        past: past.slice(0, -1),
        future: [snap(), ...future],
        selectedId: null,
        editingTextId: null,
        revision: get().revision + 1,
      });
    },

    redo: () => {
      const { past, future } = get();
      const next = future[0];
      if (!next) return;
      set({
        ...next,
        past: [...past, snap()],
        future: future.slice(1),
        selectedId: null,
        editingTextId: null,
        revision: get().revision + 1,
      });
    },

    setToolStyle: (type, patch) => {
      const styles = { ...get().styles, [type]: { ...get().styles[type], ...patch } };
      set({ styles });
      savePrefs({ styles, blur: get().blur });
    },
    setBlurPrefs: (patch) => {
      const blur = { ...get().blur, ...patch };
      set({ blur });
      savePrefs({ styles: get().styles, blur });
    },
  };
});

export function newId(): string {
  return crypto.randomUUID();
}
