/**
 * Win32 window enumeration via koffi FFI (§6). Windows only; loaded lazily.
 * Rects are physical pixels (Electron is per-monitor DPI aware v2).
 */
import type { Rect } from '@magpie/format';

interface Win32 {
  EnumWindows: (cb: unknown, lParam: number) => boolean;
  IsWindowVisible: (h: unknown) => boolean;
  IsIconic: (h: unknown) => boolean;
  GetWindowTextW: (h: unknown, buf: Buffer, max: number) => number;
  GetWindowLongPtrW: (h: unknown, idx: number) => number | bigint;
  DwmGetRect: (h: unknown, attr: number, out: Record<string, number>, size: number) => number;
  DwmGetUInt: (h: unknown, attr: number, out: number[], size: number) => number;
  proto: unknown;
  koffi: typeof import('koffi');
}

let api: Win32 | null = null;

function load(): Win32 {
  if (api) return api;
  const koffi = require('koffi') as typeof import('koffi');
  const user32 = koffi.load('user32.dll');
  const dwmapi = koffi.load('dwmapi.dll');
  koffi.struct('RECT', { left: 'long', top: 'long', right: 'long', bottom: 'long' });
  const proto = koffi.proto('bool __stdcall EnumWindowsProc(void *hwnd, intptr_t lParam)');
  api = {
    koffi,
    proto,
    EnumWindows: user32.func('bool __stdcall EnumWindows(EnumWindowsProc *cb, intptr_t lParam)'),
    IsWindowVisible: user32.func('bool __stdcall IsWindowVisible(void *hwnd)'),
    IsIconic: user32.func('bool __stdcall IsIconic(void *hwnd)'),
    GetWindowTextW: user32.func('int __stdcall GetWindowTextW(void *hwnd, _Out_ uint8_t *buf, int max)'),
    GetWindowLongPtrW: user32.func('intptr_t __stdcall GetWindowLongPtrW(void *hwnd, int index)'),
    DwmGetRect: dwmapi.func('DwmGetWindowAttribute', 'long', ['void *', 'uint32_t', koffi.out(koffi.pointer('RECT')), 'uint32_t']),
    DwmGetUInt: dwmapi.func('DwmGetWindowAttribute', 'long', ['void *', 'uint32_t', koffi.out(koffi.pointer('uint32_t')), 'uint32_t']),
  };
  return api;
}

const GWL_EXSTYLE = -20;
const WS_EX_TOOLWINDOW = 0x80;
const WS_EX_NOACTIVATE = 0x08000000;
const DWMWA_CLOAKED = 14;
const DWMWA_EXTENDED_FRAME_BOUNDS = 9;

export interface Win32Window {
  title: string;
  /** Physical pixels, visible frame (excludes invisible resize borders). */
  rect: Rect;
}

/** Visible, uncloaked, non-tool top-level windows in z-order (topmost first). */
export function listTopLevelWindows(): Win32Window[] {
  const w = load();
  const out: Win32Window[] = [];
  const titleBuf = Buffer.alloc(512 * 2);

  const cb = w.koffi.register((hwnd: unknown) => {
    try {
      if (!w.IsWindowVisible(hwnd) || w.IsIconic(hwnd)) return true;
      const ex = Number(w.GetWindowLongPtrW(hwnd, GWL_EXSTYLE));
      if (ex & WS_EX_TOOLWINDOW || ex & WS_EX_NOACTIVATE) return true;
      const cloaked = [0];
      if (w.DwmGetUInt(hwnd, DWMWA_CLOAKED, cloaked, 4) === 0 && cloaked[0]) return true;
      const r: Record<string, number> = {};
      if (w.DwmGetRect(hwnd, DWMWA_EXTENDED_FRAME_BOUNDS, r, 16) !== 0) return true;
      const rect = { x: r.left!, y: r.top!, width: r.right! - r.left!, height: r.bottom! - r.top! };
      if (rect.width < 8 || rect.height < 8) return true;
      const len = w.GetWindowTextW(hwnd, titleBuf, 512);
      const title = titleBuf.toString('utf16le', 0, len * 2);
      out.push({ title, rect });
    } catch {
      /* skip this window */
    }
    return true;
  }, w.koffi.pointer(w.proto as never));

  try {
    w.EnumWindows(cb, 0);
  } finally {
    w.koffi.unregister(cb);
  }
  return out;
}
