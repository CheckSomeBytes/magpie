/**
 * Typed IPC contract between main, preload and renderers.
 * Renderers only ever see `MagpieApi` (exposed by the preload on window.magpie).
 */
import type { AnnotationDoc, AnnotationType, DisplayInfo, Manifest, Rect } from '@magpie/format';

export type CaptureMode = 'region' | 'window' | 'full';
export type LinuxRegionMode = 'overlay' | 'editor-crop';

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
}

export interface HotkeyStatus {
  mode: CaptureMode;
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
}

export interface SavePayload {
  doc: AnnotationDoc;
  thumbWebp: Uint8Array | null;
  /** Present on an explicit save when exportPngOnSave is set. */
  flattenedPng?: Uint8Array | null;
}

export interface DoctorItem {
  level: 'ok' | 'warn' | 'error';
  message: string;
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
} as const;
