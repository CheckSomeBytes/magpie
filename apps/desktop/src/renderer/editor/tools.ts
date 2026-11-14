import type { AnnotationType, BuiltinStamp, Style } from '@magpie/format';

/** 'image' isn't a tool (images arrive by paste or custom stamps); 'ocr' is Grab text. */
export type Tool = 'select' | Exclude<AnnotationType, 'image'> | 'crop' | 'ocr';

export interface ToolDef {
  id: Tool;
  label: string;
  key: string;
  icon: string; // inline SVG path data (24×24 viewBox)
}

export const TOOLS: ToolDef[] = [
  { id: 'select', label: 'Select / move', key: 'V', icon: 'M5 3l13 8-6 1.5L15 20l-2.5 1-3-7.5L5 17z' },
  { id: 'arrow', label: 'Arrow', key: 'A', icon: 'M4 20L18 6M18 6h-8M18 6v8' },
  { id: 'line', label: 'Line', key: 'L', icon: 'M4 20L20 4' },
  { id: 'rect', label: 'Rectangle', key: 'R', icon: 'M4 6h16v12H4z' },
  { id: 'ellipse', label: 'Ellipse', key: 'E', icon: 'M12 5c4.4 0 8 3.1 8 7s-3.6 7-8 7-8-3.1-8-7 3.6-7 8-7z' },
  { id: 'text', label: 'Text', key: 'T', icon: 'M5 5h14M12 5v14M9 19h6' },
  { id: 'highlighter', label: 'Highlighter', key: 'H', icon: 'M4 18c3-1 5-6 8-6s4 4 8 3M4 21h16' },
  { id: 'blur', label: 'Blur / pixelate', key: 'B', icon: 'M4 4h4v4H4zM12 4h4v4h-4zM8 8h4v4H8zM16 8h4v4h-4zM4 12h4v4H4zM12 12h4v4h-4zM8 16h4v4H8zM16 16h4v4h-4z' },
  { id: 'step', label: 'Numbered step', key: 'N', icon: 'M12 3a9 9 0 110 18 9 9 0 010-18zM11 8l2-1v10' },
  { id: 'stamp', label: 'Stamp', key: 'M', icon: 'M12 3a9 9 0 110 18 9 9 0 010-18zM8 12.5l3 3 5-6' },
  { id: 'ocr', label: 'Grab text (OCR)', key: 'G', icon: 'M4 8V5h3M17 5h3v3M20 16v3h-3M7 19H4v-3M8 9h8M12 9v7' },
  { id: 'crop', label: 'Crop', key: 'C', icon: 'M6 2v16h16M2 6h16v16' },
];

export const PALETTE = ['#e5484d', '#f76b15', '#ffc53d', '#30a46c', '#0090ff', '#8e4ec6', '#ffffff', '#1d2026'];

export const DEFAULT_STYLES: Record<AnnotationType, Style> = {
  arrow: { stroke: '#e5484d', strokeWidth: 6 },
  line: { stroke: '#e5484d', strokeWidth: 4 },
  rect: { stroke: '#e5484d', strokeWidth: 4 },
  ellipse: { stroke: '#e5484d', strokeWidth: 4 },
  text: { stroke: '#e5484d', strokeWidth: 0, fontSize: 28, fontFamily: 'system-ui, sans-serif' },
  highlighter: { stroke: '#ffe14d', strokeWidth: 22, opacity: 0.45 },
  blur: { stroke: '#000000', strokeWidth: 0 },
  step: { stroke: '#ffffff', fill: '#e5484d', strokeWidth: 2, fontSize: 18 },
  /** fontSize = stamp size in px. */
  stamp: { stroke: '#ffffff', strokeWidth: 0, fontSize: 48 },
  image: { stroke: '#000000', strokeWidth: 0 },
};

/** Built-in stamp art: white glyph (24×24 path) on a coloured badge. */
export const STAMP_ART: Record<BuiltinStamp, { label: string; color: string; path: string; filled?: boolean }> = {
  check: { label: 'Check', color: '#30a46c', path: 'M6.5 12.5l3.5 3.5 7.5-8' },
  cross: { label: 'Cross', color: '#e5484d', path: 'M7.5 7.5l9 9M16.5 7.5l-9 9' },
  warning: { label: 'Warning', color: '#f5a524', path: 'M12 6.5v7M12 17.2v.3' },
  info: { label: 'Info', color: '#0090ff', path: 'M12 10.8v6.2M12 7v.3' },
  question: { label: 'Question', color: '#8e4ec6', path: 'M9.3 9.4a2.8 2.8 0 115.4 1c-.6 1.3-2.7 1.6-2.7 3.6M12 17.2v.3' },
  star: { label: 'Star', color: '#e8a300', path: 'M12 5.5l2 4.2 4.6.6-3.3 3.2.8 4.6L12 15.9l-4.1 2.2.8-4.6-3.3-3.2 4.6-.6z', filled: true },
};

export interface BlurPrefs {
  mode: 'blur' | 'pixelate';
  amount: number;
}

export const DEFAULT_BLUR: BlurPrefs = { mode: 'pixelate', amount: 12 };
