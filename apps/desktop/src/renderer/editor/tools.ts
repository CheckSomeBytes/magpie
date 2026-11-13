import type { AnnotationType, Style } from '@magpie/format';

export type Tool = 'select' | AnnotationType | 'crop';

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
};

export interface BlurPrefs {
  mode: 'blur' | 'pixelate';
  amount: number;
}

export const DEFAULT_BLUR: BlurPrefs = { mode: 'pixelate', amount: 12 };
