/**
 * Typed IPC contract between main, preload and renderers.
 * Renderers only ever see `MagpieApi` (exposed by the preload on window.magpie).
 */
import type { AnnotationDoc, AnnotationType, DisplayInfo, Manifest, Rect } from '@magpie/format';

export const CAPTURE_MODES = ['region', 'window', 'full', 'scroll', 'video'] as const;
export type CaptureMode = (typeof CAPTURE_MODES)[number];
export const CAPTURE_MODE_LABELS: Record<CaptureMode, string> = {
  region: 'Region',
  window: 'Window',
  full: 'Full screen',
  scroll: 'Scrolling',
  video: 'Video',
};
export type LinuxRegionMode = 'overlay' | 'editor-crop';

/** Named capture profile (Phase 4): mode + delay + what to do with the result. */
export interface CapturePreset {
  id: string;
  name: string;
  mode: 'region' | 'window' | 'full';
  delaySec: number;
  copyToClipboard: boolean;
  /** false = save to the library quietly (a notification confirms). */
  openEditor: boolean;
  tags: string[];
  /** Optional global hotkey. */
  hotkey: string;
}

export interface CaptureOptions {
  delayMs?: number;
  tags?: string[];
  copy?: boolean;
  openEditor?: boolean;
  title?: string;
}

export interface Settings {
  hotkeys: Record<CaptureMode, string>;
  /** Linux only: how "region" works after the spikes decide (§4.3). */
  linuxRegionMode: LinuxRegionMode;
  /** null = default (~/Pictures/Magpie). */
  autosaveDir: string | null;
  /** Put the raw capture on the clipboard as soon as it is taken. */
  copyOnCapture: boolean;
  /** Write a flattened .png next to the .magpie on Save (Ctrl+S). */
  exportPngOnSave: boolean;
  launchAtLogin: boolean;
  /** Read text in captures in the background so library search finds it (Phase 4). */
  ocrEnabled: boolean;
  capturePresets: CapturePreset[];
  /** Video (Phase 5): record the microphone too. */
  recordMic: boolean;
  /** Video (Phase 5, Windows only): record system audio (loopback). */
  recordSystemAudio: boolean;
}

export interface HotkeyStatus {
  /** Capture mode, or `preset:<id>`. */
  mode: CaptureMode | `preset:${string}`;
  accelerator: string;
  ok: boolean;
}

/** A window the overlay can snap to (Windows only), logical coords, z-order top first. */
export interface WindowRect {
  title: string;
  bounds: Rect;
}

export interface OverlayDisplay {
  info: DisplayInfo;
  label: string;
}

export interface OverlayInit {
  /** PNG bytes of the frame that contains this overlay's display. */
  frames: Uint8Array[];
  /** Which frame each display lives in. */
  frameIndex: Record<string, number>;
  displays: OverlayDisplay[];
  /** Display this window is showing, if main already knows it. */
  displayId: string | null;
  windows: WindowRect[];
  /** Linux: a single overlay that may not know where it landed, so show a picker. */
  showDisplayPicker: boolean;
  mode: 'region' | 'window';
}

export type OverlaySelection =
  /** rect is logical, relative to the display's top-left. */
  | { kind: 'region'; displayId: string; rect: Rect }
  /** Send the whole display to the editor with crop active. */
  | { kind: 'display'; displayId: string };

export interface EditorInit {
  path: string;
  manifest: Manifest;
  original: Uint8Array;
  doc: AnnotationDoc;
  startTool: AnnotationType | 'select' | 'crop' | null;
  settings: Settings;
  /** Embedded images (image annotations). */
  assets: Record<string, Uint8Array>;
}

export interface SavePayload {
  doc: AnnotationDoc;
  thumbWebp: Uint8Array | null;
  /** Present on an explicit save when exportPngOnSave is set. */
  flattenedPng?: Uint8Array | null;
  /** Embedded images; orphans are dropped on save. */
  assets?: Record<string, Uint8Array>;
}

/** A user stamp (Phase 4), kept in the app's data folder. */
export interface CustomStamp {
  id: string;
  name: string;
  png: Uint8Array;
}

export interface OcrJob {
  id: number;
  png: Uint8Array;
}

export interface DoctorItem {
  level: 'ok' | 'warn' | 'error';
  message: string;
}

// ---- Scrolling capture (Phase 3) -------------------------------------------

export type ScrollPhase = 'select' | 'recording' | 'review';

export interface ScrollInit {
  /** Dev only (MAGPIE_FAKE_SCROLL): a tall PNG to fake a scrolling screen stream from. */
  fakeTall: Uint8Array | null;
  /** Hotkey that finishes recording (the scroll hotkey). */
  stopHotkey: string;
}

// ---- Video (Phase 5) -------------------------------------------------------

export interface RecordInit {
  /** Dev only (MAGPIE_FAKE_VIDEO): record a synthetic animated stream instead of the screen. */
  fake: boolean;
  mic: boolean;
  systemAudio: boolean;
  stopHotkey: string;
}

export interface VideoInit {
  path: string;
  name: string;
  /** magpie-media:// URL with Range support (seekable). */
  url: string;
  duration: number;
  width: number;
  height: number;
  hasAudio: boolean;
}

export interface VideoExport {
  kind: 'mp4' | 'gif' | 'webm';
  start: number;
  end: number;
  /** GIF only. */
  gifWidth?: number;
  gifFps?: number;
}

// ---- Library (Phase 2) ----------------------------------------------------

export interface LibraryItem {
  id: number;
  path: string;
  /** Manifest title, or the file name when none was set. */
  title: string;
  customTitle: boolean;
  createdAt: string;
  modifiedAt: string;
  width: number;
  height: number;
  annotationCount: number;
  tags: string[];
  /** magpie-thumb:// URL, cache-busted by file mtime. */
  thumbUrl: string | null;
  kind: 'image' | 'video';
  /** Seconds, for videos. */
  duration: number | null;
}

export interface LibraryQuery {
  text?: string;
  /** All of these tags (AND). */
  tags?: string[];
  untagged?: boolean;
  sort?: 'newest' | 'oldest';
  limit?: number;
  offset?: number;
}

export interface LibraryResult {
  total: number;
  items: LibraryItem[];
}

export interface TagCount {
  name: string;
  count: number;
}

export interface LibraryOverview {
  root: string;
  all: number;
  untagged: number;
  tags: TagCount[];
  scanning: boolean;
}

export interface MagpieApi {
  platform: NodeJS.Platform;

  overlayInit(): Promise<OverlayInit>;
  overlayCommit(sel: OverlaySelection): void;
  overlayCancel(): void;
  onOverlayDisplay(cb: (displayId: string) => void): () => void;

  editorInit(): Promise<EditorInit>;
  editorSave(payload: SavePayload): Promise<{ path: string }>;
  editorCopy(png: Uint8Array): Promise<void>;
  editorExportPng(png: Uint8Array): Promise<string | null>;
  editorCloseReady(): void;
  editorClose(): void;
  onEditorRequestClose(cb: () => void): () => void;

  capture(mode: CaptureMode): void;
  getSettings(): Promise<Settings>;
  setSettings(patch: Partial<Settings>): Promise<{ settings: Settings; hotkeys: HotkeyStatus[] }>;
  getHotkeyStatus(): Promise<HotkeyStatus[]>;
  suspendHotkeys(suspended: boolean): void;
  chooseFolder(): Promise<string | null>;
  runDoctor(): Promise<DoctorItem[]>;

  copyText(text: string): Promise<void>;
  listStamps(): Promise<CustomStamp[]>;
  importStamp(): Promise<CustomStamp | null>;
  saveStamp(name: string, png: Uint8Array): Promise<CustomStamp>;
  deleteStamp(id: string): Promise<void>;
  runPreset(id: string): void;

  /** OCR worker window only. */
  onOcrJob(cb: (job: OcrJob) => void): () => void;
  ocrResult(id: number, text: string | null, error?: string): void;
  ocrReady(): void;
  libraryOcrText(id: number): Promise<string | null>;

  recordInit(): Promise<RecordInit>;
  recordStart(): Promise<void>;
  recordChunk(bytes: Uint8Array): Promise<void>;
  recordFinish(): Promise<void>;
  recordCancel(): void;
  onRecordStop(cb: () => void): () => void;

  videoInit(): Promise<VideoInit>;
  videoExport(opts: VideoExport): Promise<string>;
  onVideoProgress(cb: (fraction: number) => void): () => void;
  videoReveal(path?: string): void;
  videoTrash(): Promise<boolean>;

  scrollInit(): Promise<ScrollInit>;
  /** Reshape the scroll window for a phase; resolves once the window has moved out of the way. */
  scrollPhase(phase: ScrollPhase): Promise<void>;
  scrollFinish(png: Uint8Array): Promise<void>;
  scrollCancel(): void;
  onScrollStop(cb: () => void): () => void;

  openLibrary(): void;
  libraryQuery(q: LibraryQuery): Promise<LibraryResult>;
  libraryOverview(): Promise<LibraryOverview>;
  librarySetTitle(id: number, title: string): Promise<void>;
  libraryAddTag(ids: number[], tag: string): Promise<void>;
  libraryRemoveTag(ids: number[], tag: string): Promise<void>;
  libraryTrash(ids: number[]): Promise<number>;
  libraryOpen(ids: number[]): void;
  libraryReveal(id: number): void;
  libraryRescan(): Promise<void>;
  onLibraryChanged(cb: () => void): () => void;
}

/** Channel names, so main and preload can't drift. */
export const CH = {
  overlayInit: 'overlay:init',
  overlayCommit: 'overlay:commit',
  overlayCancel: 'overlay:cancel',
  overlayDisplay: 'overlay:display',
  editorInit: 'editor:init',
  editorSave: 'editor:save',
  editorCopy: 'editor:copy',
  editorExportPng: 'editor:export-png',
  editorCloseReady: 'editor:close-ready',
  editorClose: 'editor:close',
  editorRequestClose: 'editor:request-close',
  capture: 'app:capture',
  getSettings: 'settings:get',
  setSettings: 'settings:set',
  hotkeyStatus: 'settings:hotkey-status',
  suspendHotkeys: 'settings:suspend-hotkeys',
  chooseFolder: 'settings:choose-folder',
  runDoctor: 'app:doctor',
  copyText: 'app:copy-text',
  listStamps: 'stamps:list',
  importStamp: 'stamps:import',
  saveStamp: 'stamps:save',
  deleteStamp: 'stamps:delete',
  runPreset: 'app:run-preset',
  ocrJob: 'ocr:job',
  ocrResult: 'ocr:result',
  ocrReady: 'ocr:ready',
  libraryOcrText: 'library:ocr-text',
  recordInit: 'record:init',
  recordStart: 'record:start',
  recordChunk: 'record:chunk',
  recordFinish: 'record:finish',
  recordCancel: 'record:cancel',
  recordStop: 'record:stop',
  videoInit: 'video:init',
  videoExport: 'video:export',
  videoProgress: 'video:progress',
  videoReveal: 'video:reveal',
  videoTrash: 'video:trash',
  scrollInit: 'scroll:init',
  scrollPhase: 'scroll:phase',
  scrollFinish: 'scroll:finish',
  scrollCancel: 'scroll:cancel',
  scrollStop: 'scroll:stop',
  openLibrary: 'library:open-window',
  libraryQuery: 'library:query',
  libraryOverview: 'library:overview',
  librarySetTitle: 'library:set-title',
  libraryAddTag: 'library:add-tag',
  libraryRemoveTag: 'library:remove-tag',
  libraryTrash: 'library:trash',
  libraryOpen: 'library:open',
  libraryReveal: 'library:reveal',
  libraryRescan: 'library:rescan',
  libraryChanged: 'library:changed',
} as const;
