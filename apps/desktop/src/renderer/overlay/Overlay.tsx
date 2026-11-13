/**
 * Region selection over a frozen screenshot (§4.3).
 * Pointer events only: getCursorScreenPoint is unsupported on Wayland.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { DisplayInfo, Rect } from '@magpie/format';
import type { OverlayInit } from '../../shared/ipc';
import { containsPoint, intersect, rectFromPoints } from '../../shared/geometry';
import { api, loadImage, pngUrl } from '../shared/api';

const MIN_DRAG = 4; // logical px before a press counts as a drag
const LOUPE = 128; // loupe size in CSS px
const LOUPE_PX = 15; // physical pixels shown across the loupe

interface Pointer {
  x: number;
  y: number;
}

export function Overlay() {
  const [init, setInit] = useState<OverlayInit | null>(null);
  const [displayId, setDisplayId] = useState<string | null>(null);
  const [frames, setFrames] = useState<HTMLImageElement[]>([]);
  const [dragging, setDragging] = useState(false);
  const baseRef = useRef<HTMLCanvasElement>(null);
  const uiRef = useRef<HTMLCanvasElement>(null);
  const pointer = useRef<Pointer | null>(null);
  const dragStart = useRef<Pointer | null>(null);
  const raf = useRef(0);

  useEffect(() => {
    let urls: string[] = [];
    void api.overlayInit().then(async (i) => {
      urls = i.frames.map(pngUrl);
      const imgs = await Promise.all(urls.map(loadImage));
      setInit(i);
      setDisplayId(i.displayId ?? i.displays[0]?.info.id ?? null);
      setFrames(imgs);
    });
    const off = api.onOverlayDisplay(setDisplayId);
    return () => {
      off();
      urls.forEach(URL.revokeObjectURL);
    };
  }, []);

  const display: DisplayInfo | null = useMemo(
    () => init?.displays.find((d) => d.info.id === displayId)?.info ?? null,
    [init, displayId],
  );
  const frame = display && init ? frames[init.frameIndex[display.id] ?? 0] ?? null : null;

  /** Window rects relative to this display, clipped to it. */
  const windows = useMemo(() => {
    if (!init || !display) return [];
    const local = { x: 0, y: 0, width: display.bounds.width, height: display.bounds.height };
    return init.windows
      .map((w) => intersect({ ...w.bounds, x: w.bounds.x - display.bounds.x, y: w.bounds.y - display.bounds.y }, local))
      .filter((r): r is Rect => r !== null);
  }, [init, display]);

  // CSS px → display-logical px (normally 1:1; differs if the window landed oddly on Wayland).
  const toLogical = useCallback(
    (p: Pointer): Pointer => {
      if (!display) return p;
      return { x: (p.x * display.bounds.width) / window.innerWidth, y: (p.y * display.bounds.height) / window.innerHeight };
    },
    [display],
  );

  // ---- painting -----------------------------------------------------------
  const paintBase = useCallback(() => {
    const c = baseRef.current;
    if (!c || !frame || !display) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(window.innerWidth * dpr);
    c.height = Math.round(window.innerHeight * dpr);
    const ctx = c.getContext('2d')!;
    const s = display.rectPx;
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(frame, s.x, s.y, s.width, s.height, 0, 0, c.width, c.height);
  }, [frame, display]);

  const selection = (): Rect | null => {
    const a = dragStart.current;
    const b = pointer.current;
    if (!a || !b) return null;
    const r = rectFromPoints(a.x, a.y, b.x, b.y);
    return r.width >= MIN_DRAG || r.height >= MIN_DRAG ? r : null;
  };

  const hoveredWindow = (): Rect | null => {
    const p = pointer.current;
    if (!p || dragStart.current) return null;
    const lp = toLogical(p);
    const hit = windows.find((w) => containsPoint(w, lp.x, lp.y));
    if (!hit || !display) return null;
    // back to CSS px
    const kx = window.innerWidth / display.bounds.width;
    const ky = window.innerHeight / display.bounds.height;
    return { x: hit.x * kx, y: hit.y * ky, width: hit.width * kx, height: hit.height * ky };
  };

  const paintUi = useCallback(() => {
    raf.current = 0;
    const c = uiRef.current;
    const base = baseRef.current;
    if (!c || !base || !display) return;
    const dpr = window.devicePixelRatio || 1;
    const W = window.innerWidth;
    const H = window.innerHeight;
    if (c.width !== Math.round(W * dpr)) {
      c.width = Math.round(W * dpr);
      c.height = Math.round(H * dpr);
    }
    const ctx = c.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const sel = selection();
    const hover = init?.mode === 'window' || !sel ? hoveredWindow() : null;
    const focus = sel ?? hover;

    // Dim everything except the focus rect.
    ctx.fillStyle = 'rgba(0,0,0,0.45)';
    ctx.beginPath();
    ctx.rect(0, 0, W, H);
    if (focus) ctx.rect(focus.x, focus.y, focus.width, focus.height);
    ctx.fill('evenodd');

    if (focus) {
      ctx.strokeStyle = sel ? '#4c8dff' : 'rgba(76,141,255,0.9)';
      ctx.lineWidth = sel ? 1.5 : 3;
      ctx.strokeRect(focus.x + 0.5, focus.y + 0.5, focus.width - 1, focus.height - 1);
      // Size label in physical pixels.
      const kx = display.rectPx.width / W;
      const ky = display.rectPx.height / H;
      const label = `${Math.round(focus.width * kx)} × ${Math.round(focus.height * ky)}`;
      ctx.font = '12px system-ui, sans-serif';
      const tw = ctx.measureText(label).width + 12;
      const lx = Math.min(Math.max(focus.x, 4), W - tw - 4);
      const ly = focus.y > 26 ? focus.y - 24 : Math.min(focus.y + focus.height + 6, H - 22);
      ctx.fillStyle = 'rgba(20,22,26,0.9)';
      ctx.fillRect(lx, ly, tw, 20);
      ctx.fillStyle = '#fff';
      ctx.fillText(label, lx + 6, ly + 14);
    }

    const p = pointer.current;
    if (p && init?.mode !== 'window') {
      // Crosshair
      ctx.strokeStyle = 'rgba(255,255,255,0.55)';
      ctx.lineWidth = 1;
      ctx.setLineDash([4, 4]);
      ctx.beginPath();
      ctx.moveTo(0, Math.round(p.y) + 0.5);
      ctx.lineTo(W, Math.round(p.y) + 0.5);
      ctx.moveTo(Math.round(p.x) + 0.5, 0);
      ctx.lineTo(Math.round(p.x) + 0.5, H);
      ctx.stroke();
      ctx.setLineDash([]);
      drawLoupe(ctx, base, p, W, H, dpr, display);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [display, init, windows, toLogical]);

  const schedule = useCallback(() => {
    if (!raf.current) raf.current = requestAnimationFrame(paintUi);
  }, [paintUi]);

  useEffect(() => {
    paintBase();
    schedule();
    const onResize = () => {
      paintBase();
      schedule();
    };
    window.addEventListener('resize', onResize);
    return () => window.removeEventListener('resize', onResize);
  }, [paintBase, schedule]);

  // ---- commit -------------------------------------------------------------
  const commitRect = useCallback(
    (cssRect: Rect) => {
      if (!display) return;
      const a = toLogical({ x: cssRect.x, y: cssRect.y });
      const b = toLogical({ x: cssRect.x + cssRect.width, y: cssRect.y + cssRect.height });
      api.overlayCommit({ kind: 'region', displayId: display.id, rect: rectFromPoints(a.x, a.y, b.x, b.y) });
    },
    [display, toLogical],
  );

  const commitWholeDisplay = useCallback(() => {
    if (display) commitRect({ x: 0, y: 0, width: window.innerWidth, height: window.innerHeight });
  }, [display, commitRect]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (dragStart.current) {
          dragStart.current = null;
          setDragging(false);
          schedule();
        } else api.overlayCancel();
      } else if (e.key === 'Enter' || e.key === ' ') {
        commitWholeDisplay();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [commitWholeDisplay, schedule]);

  // ---- pointer ------------------------------------------------------------
  const onPointerMove = (e: React.PointerEvent) => {
    pointer.current = { x: e.clientX, y: e.clientY };
    schedule();
  };
  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button === 2) {
      api.overlayCancel();
      return;
    }
    if (e.button !== 0) return;
    (e.target as Element).setPointerCapture(e.pointerId);
    pointer.current = { x: e.clientX, y: e.clientY };
    if (init?.mode === 'region') {
      dragStart.current = { ...pointer.current };
      setDragging(true);
    }
    schedule();
  };
  const onPointerUp = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    pointer.current = { x: e.clientX, y: e.clientY };
    const sel = selection();
    dragStart.current = null;
    setDragging(false);
    if (sel) {
      commitRect(sel);
      return;
    }
    // Click without drag: snap to the window under the pointer (Windows).
    const w = hoveredWindow();
    if (w) commitRect(w);
    schedule();
  };

  const ready = !!(init && frame && display);
  const multi = init?.showDisplayPicker && init.displays.length > 1;

  return (
    <div
      className="stage"
      onPointerMove={onPointerMove}
      onPointerDown={onPointerDown}
      onPointerUp={onPointerUp}
      onContextMenu={(e) => e.preventDefault()}
    >
      <canvas ref={baseRef} />
      <canvas ref={uiRef} />
      {ready && multi && (
        <div className={`picker ${dragging ? 'hidden' : ''}`} onPointerDown={(e) => e.stopPropagation()} onPointerUp={(e) => e.stopPropagation()}>
          <span>Screen:</span>
          {init!.displays.map((d) => (
            <button key={d.info.id} className={d.info.id === displayId ? 'active' : ''} onClick={() => setDisplayId(d.info.id)}>
              {d.label}
            </button>
          ))}
          <span className="sep" />
          {init!.displays
            .filter((d) => d.info.id !== displayId)
            .map((d) => (
              <button key={`send-${d.info.id}`} onClick={() => api.overlayCommit({ kind: 'display', displayId: d.info.id })}>
                Crop {d.label} in editor
              </button>
            ))}
        </div>
      )}
      {ready && !dragging && (
        <div className="hint">
          {init!.mode === 'window'
            ? 'Click a window · Enter = whole screen · Esc = cancel'
            : windows.length
              ? 'Drag to select · Click a window · Enter = whole screen · Esc = cancel'
              : 'Drag to select · Enter = whole screen · Esc = cancel'}
        </div>
      )}
    </div>
  );
}

function drawLoupe(
  ctx: CanvasRenderingContext2D,
  base: HTMLCanvasElement,
  p: Pointer,
  W: number,
  H: number,
  dpr: number,
  display: DisplayInfo,
): void {
  // Sample from the base canvas (≈ physical pixels).
  const half = Math.floor(LOUPE_PX / 2);
  const cx = Math.floor(p.x * dpr);
  const cy = Math.floor(p.y * dpr);
  let x = p.x + 24;
  let y = p.y + 24;
  if (x + LOUPE > W) x = p.x - 24 - LOUPE;
  if (y + LOUPE + 22 > H) y = p.y - 24 - LOUPE - 22;

  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, LOUPE, LOUPE);
  ctx.clip();
  ctx.imageSmoothingEnabled = false;
  ctx.fillStyle = '#000';
  ctx.fillRect(x, y, LOUPE, LOUPE);
  ctx.drawImage(base, cx - half, cy - half, LOUPE_PX, LOUPE_PX, x, y, LOUPE, LOUPE);
  const cell = LOUPE / LOUPE_PX;
  ctx.strokeStyle = 'rgba(255,255,255,0.08)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let i = 1; i < LOUPE_PX; i++) {
    ctx.moveTo(x + i * cell, y);
    ctx.lineTo(x + i * cell, y + LOUPE);
    ctx.moveTo(x, y + i * cell);
    ctx.lineTo(x + LOUPE, y + i * cell);
  }
  ctx.stroke();
  ctx.strokeStyle = '#4c8dff';
  ctx.lineWidth = 2;
  ctx.strokeRect(x + half * cell, y + half * cell, cell, cell);
  ctx.restore();
  ctx.strokeStyle = 'rgba(255,255,255,0.6)';
  ctx.lineWidth = 1;
  ctx.strokeRect(x + 0.5, y + 0.5, LOUPE - 1, LOUPE - 1);

  // Coordinates (physical) + pixel color.
  let hex = '';
  try {
    const d = base.getContext('2d')!.getImageData(cx, cy, 1, 1).data;
    hex = '#' + [d[0], d[1], d[2]].map((v) => (v ?? 0).toString(16).padStart(2, '0')).join('');
  } catch {
    /* tainted or out of range */
  }
  const px = Math.round((p.x * display.rectPx.width) / W);
  const py = Math.round((p.y * display.rectPx.height) / H);
  const text = `${px}, ${py}  ${hex}`;
  ctx.font = '11px ui-monospace, monospace';
  ctx.fillStyle = 'rgba(20,22,26,0.9)';
  ctx.fillRect(x, y + LOUPE, LOUPE, 20);
  ctx.fillStyle = '#fff';
  ctx.fillText(text, x + 6, y + LOUPE + 14);
}
