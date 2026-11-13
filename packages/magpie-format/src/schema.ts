/**
 * The .magpie project schema. Pure data: no DOM, no Node, no Konva.
 *
 * All coordinates are in image pixels of `original.png` (physical pixels of
 * the capture). The editor maps them to screen space; the file never stores
 * view state.
 */

export const FORMAT_ID = 'magpie';
export const FORMAT_VERSION = 1;
export const FILE_EXTENSION = '.magpie';

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DisplayInfo {
  id: string;
  /** Logical (DIP) bounds as Electron reports them. */
  bounds: Rect;
  scaleFactor: number;
  /** Where this display sits inside the captured frame, in image pixels. */
  rectPx: Rect;
}

export interface Manifest {
  format: typeof FORMAT_ID;
  version: number;
  app: { name: string; version: string };
  created: string;
  modified: string;
  os: { platform: string; release: string; session?: string };
  image: { widthPx: number; heightPx: number };
  source: 'portal' | 'desktopCapturer' | 'import';
  displays: DisplayInfo[];
  /** Zip entry name of the thumbnail, or null when none was written. */
  thumb: 'thumb.webp' | 'thumb.png' | null;
  title?: string;
}

export interface Style {
  stroke: string;
  fill?: string;
  strokeWidth: number;
  opacity?: number;
  fontSize?: number;
  fontFamily?: string;
}

interface Base<T extends string, D> {
  id: string;
  type: T;
  x: number;
  y: number;
  rotation: number;
  style: Style;
  data: D;
}

/** Two-point shapes. `points` are relative to (x, y). */
export type ArrowAnnotation = Base<'arrow', { points: [number, number, number, number] }>;
export type LineAnnotation = Base<'line', { points: [number, number, number, number] }>;
export type RectAnnotation = Base<'rect', { width: number; height: number; cornerRadius?: number }>;
export type EllipseAnnotation = Base<'ellipse', { radiusX: number; radiusY: number }>;
export type TextAnnotation = Base<'text', { text: string; width: number }>;
/** Freehand stroke, flat [x0, y0, x1, y1, ...] relative to (x, y). */
export type HighlighterAnnotation = Base<'highlighter', { points: number[] }>;
export type BlurAnnotation = Base<
  'blur',
  { width: number; height: number; mode: 'blur' | 'pixelate'; amount: number }
>;
/** Numbered callout. `number` is derived from order but stored for readers. */
export type StepAnnotation = Base<'step', { number: number; radius: number }>;

export type Annotation =
  | ArrowAnnotation
  | LineAnnotation
  | RectAnnotation
  | EllipseAnnotation
  | TextAnnotation
  | HighlighterAnnotation
  | BlurAnnotation
  | StepAnnotation;

export type AnnotationType = Annotation['type'];

export const ANNOTATION_TYPES: readonly AnnotationType[] = [
  'arrow',
  'line',
  'rect',
  'ellipse',
  'text',
  'highlighter',
  'blur',
  'step',
];

export interface AnnotationDoc {
  version: number;
  /** Crop applied on export, in image pixels. null = whole image. */
  crop: Rect | null;
  annotations: Annotation[];
}

export interface MagpieProject {
  manifest: Manifest;
  /** PNG bytes of the untouched capture. */
  original: Uint8Array;
  doc: AnnotationDoc;
  thumb: Uint8Array | null;
}

export function emptyDoc(): AnnotationDoc {
  return { version: FORMAT_VERSION, crop: null, annotations: [] };
}
