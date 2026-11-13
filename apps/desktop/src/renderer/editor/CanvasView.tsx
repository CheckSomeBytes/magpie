/**
 * Konva stage (§7): Stage → bgLayer (capture, listening:false) → annotLayer → uiLayer.
 * Annotations live in image pixels; the stage is scaled by `scale` and offset
 * so the current view (whole image, or the crop) fills the canvas.
 */
import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from 'react';
import type Konva from 'konva';
import { Circle, Image as KImage, Layer, Rect as KRect, Stage, Transformer } from 'react-konva';
import { nextStepNumber, type Annotation, type Rect } from '@magpie/format';
import { rectFromPoints } from '../../shared/geometry';
import { dataUrlToBytes } from '../shared/api';
import { AnnotationNode } from './shapes';
import { newId, useEditor } from './store';
import type { Tool } from './tools';

export interface FlattenOptions {
  maxWidth?: number;
  mimeType?: 'image/png' | 'image/webp';
  quality?: number;
}

export interface CanvasHandle {
  flatten(opts?: FlattenOptions): Promise<Uint8Array>;
  commitText(): void;
}

interface Props {
  bg: HTMLImageElement;
  scale: number;
}

type DrawTool = Exclude<Tool, 'select' | 'crop' | 'text' | 'step'>;

const TRANSFORMABLE = new Set(['rect', 'ellipse', 'text', 'blur', 'step']);

function snap45(dx: number, dy: number): [number, number] {
  const len = Math.hypot(dx, dy);
  const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
  return [Math.round(Math.cos(ang) * len), Math.round(Math.sin(ang) * len)];
}

function clampRect(r: Rect, W: number, H: number): Rect {
  const x = Math.max(0, Math.min(Math.round(r.x), W - 1));
  const y = Math.max(0, Math.min(Math.round(r.y), H - 1));
  return { x, y, width: Math.max(1, Math.min(Math.round(r.width), W - x)), height: Math.max(1, Math.min(Math.round(r.height), H - y)) };
}

export const CanvasView = forwardRef<CanvasHandle, Props>(function CanvasView({ bg, scale: s }, ref) {
  const annotations = useEditor((st) => st.annotations);
  const crop = useEditor((st) => st.crop);
  const tool = useEditor((st) => st.tool);
  const selectedId = useEditor((st) => st.selectedId);
  const editingTextId = useEditor((st) => st.editingTextId);
  const styles = useEditor((st) => st.styles);
  const blurPrefs = useEditor((st) => st.blur);
  const ed = useEditor.getState;

  const W = bg.naturalWidth;
  const H = bg.naturalHeight;
  const full: Rect = useMemo(() => ({ x: 0, y: 0, width: W, height: H }), [W, H]);
  const cropping = tool === 'crop';
  const view = !cropping && crop ? crop : full;

  const stageRef = useRef<Konva.Stage>(null);
  const uiLayerRef = useRef<Konva.Layer>(null);
  const trRef = useRef<Konva.Transformer>(null);
  const cropRectRef = useRef<Konva.Rect>(null);
  const cropTrRef = useRef<Konva.Transformer>(null);
  const nodes = useRef(new Map<string, Konva.Node>());
  const drawStart = useRef<{ x: number; y: number } | null>(null);
  const newTextId = useRef<string | null>(null);
  const [draft, setDraftState] = useState<Annotation | null>(null);
  const [cropDraft, setCropDraftState] = useState<Rect | null>(null);
  const draftRef = useRef<Annotation | null>(null);
  const cropDraftRef = useRef<Rect | null>(null);
  const setDraft = (d: Annotation | null) => {
    draftRef.current = d;
    setDraftState(d);
  };
  const setCropDraft = (r: Rect | null) => {
    cropDraftRef.current = r;
    setCropDraftState(r);
  };

  const register = useCallback((id: string, n: Konva.Node | null) => {
    if (n) nodes.current.set(id, n);
    else nodes.current.delete(id);
  }, []);

  const pointer = (): { x: number; y: number } => stageRef.current?.getRelativePointerPosition() ?? { x: 0, y: 0 };

  // ---- transformer attachment --------------------------------------------
  const selected = annotations.find((a) => a.id === selectedId) ?? null;
  useEffect(() => {
    const tr = trRef.current;
    if (!tr) return;
    const node = selected && TRANSFORMABLE.has(selected.type) && editingTextId !== selected.id ? nodes.current.get(selected.id) : undefined;
    tr.nodes(node ? [node] : []);
    tr.getLayer()?.batchDraw();
  }, [selected, editingTextId, annotations]);

  useEffect(() => {
    if (cropping && cropRectRef.current && cropTrRef.current) {
      cropTrRef.current.nodes([cropRectRef.current]);
      cropTrRef.current.getLayer()?.batchDraw();
    }
  }, [cropping, crop, cropDraft]);

  // ---- drawing --------------------------------------------------------------
  const makeDraft = (t: DrawTool, a: { x: number; y: number }, b: { x: number; y: number }, shift: boolean, id: string): Annotation => {
    const style = { ...styles[t] };
    switch (t) {
      case 'arrow':
      case 'line': {
        let dx = b.x - a.x;
        let dy = b.y - a.y;
        if (shift) [dx, dy] = snap45(dx, dy);
        return { id, type: t, x: a.x, y: a.y, rotation: 0, style, data: { points: [0, 0, dx, dy] } };
      }
      case 'rect':
      case 'blur': {
        let r = rectFromPoints(a.x, a.y, b.x, b.y);
        if (shift) {
          const m = Math.max(r.width, r.height);
          r = rectFromPoints(a.x, a.y, a.x + Math.sign(b.x - a.x || 1) * m, a.y + Math.sign(b.y - a.y || 1) * m);
        }
        if (t === 'rect') return { id, type: 'rect', x: r.x, y: r.y, rotation: 0, style, data: { width: r.width, height: r.height } };
        return { id, type: 'blur', x: r.x, y: r.y, rotation: 0, style, data: { width: r.width, height: r.height, mode: blurPrefs.mode, amount: blurPrefs.amount } };
      }
      case 'ellipse': {
        let rx = Math.abs(b.x - a.x) / 2;
        let ry = Math.abs(b.y - a.y) / 2;
        if (shift) rx = ry = Math.max(rx, ry);
        const cx = a.x + Math.sign(b.x - a.x) * rx;
        const cy = a.y + Math.sign(b.y - a.y) * ry;
        return { id, type: 'ellipse', x: cx, y: cy, rotation: 0, style, data: { radiusX: rx, radiusY: ry } };
      }
      case 'highlighter':
        return { id, type: 'highlighter', x: a.x, y: a.y, rotation: 0, style, data: { points: [0, 0, b.x - a.x, b.y - a.y] } };
    }
  };

  const draftBigEnough = (d: Annotation): boolean => {
    const min = 3 / s;
    switch (d.type) {
      case 'arrow':
      case 'line':
        return Math.hypot(d.data.points[2], d.data.points[3]) >= min * 2;
      case 'rect':
      case 'blur':
        return d.data.width >= min && d.data.height >= min;
      case 'ellipse':
        return d.data.radiusX >= min / 2 && d.data.radiusY >= min / 2;
      case 'highlighter':
        return d.data.points.length >= 4;
      default:
        return true;
    }
  };

  const onMouseDown = (e: Konva.KonvaEventObject<MouseEvent>) => {
    if (e.evt.button !== 0) return;
    if (ed().editingTextId) return; // the textarea's blur commits it
    const stage = stageRef.current!;
    const p = pointer();
    const onBackground = e.target === stage || e.target.getLayer()?.name() === 'bg';

    switch (tool) {
      case 'select':
        if (onBackground) ed().select(null);
        return;
      case 'crop':
        if (e.target === cropRectRef.current || e.target.getParent() === cropTrRef.current) return;
        drawStart.current = p;
        setCropDraft({ x: p.x, y: p.y, width: 0, height: 0 });
        return;
      case 'text': {
        const id = newId();
        const style = { ...styles.text };
        ed().checkpoint();
        ed().add(
          { id, type: 'text', x: p.x, y: p.y - (style.fontSize ?? 28) * 0.6, rotation: 0, style, data: { text: '', width: Math.max(160, Math.round(360 / Math.max(s, 0.25))) } },
          { history: false },
        );
        newTextId.current = id;
        ed().select(id);
        ed().setEditingText(id);
        return;
      }
      case 'step': {
        const id = newId();
        const r = styles.step.fontSize ?? 18;
        ed().add({ id, type: 'step', x: p.x, y: p.y, rotation: 0, style: { ...styles.step }, data: { number: nextStepNumber(ed().annotations), radius: r } });
        ed().select(id);
        return;
      }
      default: {
        ed().select(null);
        drawStart.current = p;
        setDraft(makeDraft(tool, p, p, e.evt.shiftKey, newId()));
      }
    }
  };

  const onMouseMove = (e: Konva.KonvaEventObject<MouseEvent>) => {
    const start = drawStart.current;
    if (!start) return;
    const p = pointer();
    if (cropping) {
      setCropDraft(rectFromPoints(start.x, start.y, p.x, p.y));
      return;
    }
    const d = draftRef.current;
    if (!d) return;
    if (d.type === 'highlighter') {
      const pts = d.data.points;
      const lx = pts[pts.length - 2]!;
      const ly = pts[pts.length - 1]!;
      const nx = p.x - d.x;
      const ny = p.y - d.y;
      if (Math.hypot(nx - lx, ny - ly) < 2 / s) return;
      // Shift = straight horizontal swipe.
      setDraft({ ...d, data: { points: e.evt.shiftKey ? [0, 0, nx, 0] : [...pts, nx, ny] } });
      return;
    }
    setDraft(makeDraft(tool as DrawTool, start, p, e.evt.shiftKey, d.id));
  };

  const finishGesture = useCallback(() => {
    if (!drawStart.current) return;
    drawStart.current = null;
    const cd = cropDraftRef.current;
    const d = draftRef.current;
    setCropDraft(null);
    setDraft(null);
    if (cd && cd.width * s >= 4 && cd.height * s >= 4) ed().setCrop(clampRect(cd, W, H));
    if (d && draftBigEnough(d)) {
      ed().add(d);
      ed().select(d.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [s, W, H]);

  useEffect(() => {
    window.addEventListener('mouseup', finishGesture);
    return () => window.removeEventListener('mouseup', finishGesture);
  }, [finishGesture]);

  // ---- model updates from Konva ------------------------------------------
  const onDragEnd = (id: string, x: number, y: number) => ed().update(id, { x, y });

  const onTransform = () => {
    // Text: turn horizontal scaling into width live, so glyphs never stretch.
    const a = selected;
    const node = a ? nodes.current.get(a.id) : undefined;
    if (a?.type === 'text' && node) {
      node.setAttrs({ width: Math.max(40, node.width() * node.scaleX()), scaleX: 1, scaleY: 1 });
    }
  };

  const onTransformEnd = () => {
    const a = selected;
    const node = a ? nodes.current.get(a.id) : undefined;
    if (!a || !node) return;
    const sx = node.scaleX();
    const sy = node.scaleY();
    node.scale({ x: 1, y: 1 });
    const base = { x: node.x(), y: node.y(), rotation: node.rotation() };
    ed().update(a.id, (cur) => {
      switch (cur.type) {
        case 'rect':
          return { ...cur, ...base, data: { ...cur.data, width: Math.max(1, cur.data.width * sx), height: Math.max(1, cur.data.height * sy) } };
        case 'ellipse':
          return { ...cur, ...base, data: { radiusX: Math.max(1, cur.data.radiusX * sx), radiusY: Math.max(1, cur.data.radiusY * sy) } };
        case 'text':
          return { ...cur, ...base, data: { ...cur.data, width: Math.max(40, node.width()) } };
        case 'blur':
          return { ...cur, ...base, rotation: 0, data: { ...cur.data, width: Math.max(4, cur.data.width * sx), height: Math.max(4, cur.data.height * sy) } };
        case 'step':
          return { ...cur, ...base, rotation: 0, data: { ...cur.data, radius: Math.max(8, cur.data.radius * Math.max(sx, sy)) } };
        default:
          return cur;
      }
    });
  };

  // ---- text editing ---------------------------------------------------------
  const editing = annotations.find((a) => a.id === editingTextId && a.type === 'text') ?? null;
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (editing && textareaRef.current) {
      const ta = textareaRef.current;
      ta.value = editing.type === 'text' ? editing.data.text : '';
      ta.focus();
      ta.select();
      autoGrow(ta);
    }
    // only when a new edit session begins
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editingTextId]);

  const commitText = useCallback(() => {
    const st = ed();
    const id = st.editingTextId;
    if (!id) return;
    const value = textareaRef.current?.value ?? '';
    const isNew = newTextId.current === id;
    newTextId.current = null;
    st.setEditingText(null);
    if (!value.trim()) {
      st.remove(id, { history: !isNew });
      if (isNew) st.dropCheckpoint();
      return;
    }
    st.update(id, (a) => (a.type === 'text' ? { ...a, data: { ...a.data, text: value } } : a), { history: !isNew });
  }, [ed]);

  const startEditText = (id: string) => {
    const a = ed().annotations.find((x) => x.id === id);
    if (a?.type !== 'text') return;
    newTextId.current = null;
    ed().select(id);
    ed().setEditingText(id);
  };

  // ---- export ---------------------------------------------------------------
  useImperativeHandle(
    ref,
    () => ({
      commitText,
      async flatten(opts: FlattenOptions = {}) {
        const stage = stageRef.current!;
        const ui = uiLayerRef.current!;
        const r = ed().crop ?? full;
        const sc = stage.scaleX();
        const vx = -stage.x() / sc;
        const vy = -stage.y() / sc;
        let pixelRatio = 1 / sc;
        if (opts.maxWidth && r.width > opts.maxWidth) pixelRatio = opts.maxWidth / (r.width * sc);
        ui.hide();
        try {
          const url = stage.toDataURL({
            x: (r.x - vx) * sc,
            y: (r.y - vy) * sc,
            width: r.width * sc,
            height: r.height * sc,
            pixelRatio,
            mimeType: opts.mimeType ?? 'image/png',
            quality: opts.quality,
          });
          return await dataUrlToBytes(url);
        } finally {
          ui.show();
        }
      },
    }),
    [commitText, full, ed],
  );

  // ---- render ---------------------------------------------------------------
  const interactiveFor = (a: Annotation) => !cropping && (tool === 'select' || a.id === selectedId);
  const anchorR = 7 / s;
  const twoPoint = selected && (selected.type === 'arrow' || selected.type === 'line') && !cropping ? selected : null;
  const cropRect = cropDraft ?? crop ?? full;

  const trConfig = (() => {
    switch (selected?.type) {
      case 'text':
        return { enabledAnchors: ['middle-left', 'middle-right'], rotateEnabled: true, keepRatio: false };
      case 'step':
        return { enabledAnchors: ['top-left', 'top-right', 'bottom-left', 'bottom-right'], rotateEnabled: false, keepRatio: true };
      case 'blur':
        return { enabledAnchors: undefined, rotateEnabled: false, keepRatio: false };
      default:
        return { enabledAnchors: undefined, rotateEnabled: true, keepRatio: false };
    }
  })();

  const cursor = tool === 'select' ? 'default' : tool === 'text' ? 'text' : 'crosshair';

  return (
    <div className="canvas-wrap" style={{ width: view.width * s, height: view.height * s, cursor }}>
      <Stage
        ref={stageRef}
        width={Math.round(view.width * s)}
        height={Math.round(view.height * s)}
        scaleX={s}
        scaleY={s}
        x={-view.x * s}
        y={-view.y * s}
        onMouseDown={onMouseDown}
        onMouseMove={onMouseMove}
      >
        <Layer name="bg" listening={false}>
          <KImage image={bg} x={0} y={0} width={W} height={H} />
        </Layer>
        <Layer name="annotations">
          {annotations.map((a) => (
            <AnnotationNode
              key={a.id}
              a={a}
              bg={bg}
              interactive={interactiveFor(a)}
              hidden={a.id === editingTextId}
              register={register}
              onSelect={(id) => ed().select(id)}
              onDragEnd={onDragEnd}
              onDblClick={startEditText}
            />
          ))}
          {draft && <AnnotationNode a={draft} bg={bg} interactive={false} register={() => {}} onSelect={() => {}} onDragEnd={() => {}} />}
        </Layer>
        <Layer name="ui" ref={uiLayerRef}>
          <Transformer
            ref={trRef}
            enabledAnchors={trConfig.enabledAnchors}
            rotateEnabled={trConfig.rotateEnabled}
            keepRatio={trConfig.keepRatio}
            ignoreStroke
            anchorSize={9}
            borderStroke="#4c8dff"
            anchorStroke="#4c8dff"
            onTransform={onTransform}
            onTransformEnd={onTransformEnd}
            boundBoxFunc={(oldBox, newBox) => (newBox.width < 6 || newBox.height < 6 ? oldBox : newBox)}
          />
          {twoPoint && (
            <>
              {[0, 1].map((i) => (
                <Circle
                  key={i}
                  x={twoPoint.x + twoPoint.data.points[i * 2]!}
                  y={twoPoint.y + twoPoint.data.points[i * 2 + 1]!}
                  radius={anchorR}
                  fill="#ffffff"
                  stroke="#4c8dff"
                  strokeWidth={2 / s}
                  draggable
                  onMouseDown={(e) => (e.cancelBubble = true)}
                  onDragStart={() => ed().checkpoint()}
                  onDragMove={(e) => {
                    const ax = e.target.x();
                    const ay = e.target.y();
                    ed().update(
                      twoPoint.id,
                      (cur) => {
                        if (cur.type !== 'arrow' && cur.type !== 'line') return cur;
                        const abs = [cur.x + cur.data.points[0], cur.y + cur.data.points[1], cur.x + cur.data.points[2], cur.y + cur.data.points[3]];
                        abs[i * 2] = ax;
                        abs[i * 2 + 1] = ay;
                        return { ...cur, x: abs[0]!, y: abs[1]!, data: { points: [0, 0, abs[2]! - abs[0]!, abs[3]! - abs[1]!] } };
                      },
                      { history: false },
                    );
                  }}
                />
              ))}
            </>
          )}
          {cropping && (
            <>
              {/* Dim outside the crop. */}
              <KRect x={0} y={0} width={W} height={cropRect.y} fill="rgba(0,0,0,0.55)" listening={false} />
              <KRect x={0} y={cropRect.y + cropRect.height} width={W} height={H - cropRect.y - cropRect.height} fill="rgba(0,0,0,0.55)" listening={false} />
              <KRect x={0} y={cropRect.y} width={cropRect.x} height={cropRect.height} fill="rgba(0,0,0,0.55)" listening={false} />
              <KRect x={cropRect.x + cropRect.width} y={cropRect.y} width={W - cropRect.x - cropRect.width} height={cropRect.height} fill="rgba(0,0,0,0.55)" listening={false} />
              <KRect
                ref={cropRectRef}
                x={cropRect.x}
                y={cropRect.y}
                width={cropRect.width}
                height={cropRect.height}
                stroke="#ffffff"
                strokeWidth={1.5 / s}
                dash={[6 / s, 4 / s]}
                fill="rgba(0,0,0,0.001)"
                draggable={!cropDraft}
                onMouseDown={(e) => (e.cancelBubble = true)}
                onDragEnd={(e) => {
                  const n = e.target;
                  ed().setCrop(clampRect({ x: n.x(), y: n.y(), width: cropRect.width, height: cropRect.height }, W, H));
                }}
                onTransformEnd={(e) => {
                  const n = e.target;
                  const r = { x: n.x(), y: n.y(), width: n.width() * n.scaleX(), height: n.height() * n.scaleY() };
                  n.scale({ x: 1, y: 1 });
                  ed().setCrop(clampRect(r, W, H));
                }}
              />
              {!cropDraft && <Transformer ref={cropTrRef} rotateEnabled={false} keepRatio={false} ignoreStroke anchorSize={10} borderStroke="#ffffff" anchorStroke="#ffffff" anchorFill="#4c8dff" />}
            </>
          )}
        </Layer>
      </Stage>
      {editing && editing.type === 'text' && (
        <textarea
          ref={textareaRef}
          className="text-editor"
          spellCheck
          style={{
            left: (editing.x - view.x) * s,
            top: (editing.y - view.y) * s,
            width: editing.data.width * s,
            fontSize: (editing.style.fontSize ?? 28) * s,
            fontFamily: editing.style.fontFamily ?? 'system-ui, sans-serif',
            color: editing.style.stroke,
            padding: 4 * s,
            transform: `rotate(${editing.rotation}deg)`,
          }}
          onInput={(e) => autoGrow(e.currentTarget)}
          onBlur={commitText}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === 'Escape' || (e.key === 'Enter' && (e.ctrlKey || e.metaKey))) {
              e.preventDefault();
              commitText();
            }
          }}
        />
      )}
    </div>
  );
});

function autoGrow(ta: HTMLTextAreaElement): void {
  ta.style.height = 'auto';
  ta.style.height = `${ta.scrollHeight}px`;
}
