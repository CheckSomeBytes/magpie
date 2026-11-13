/**
 * One Konva node per annotation. Positions/sizes are image pixels.
 * Drag/transform results are reported back through onChange (baked into the
 * model: no lingering scaleX/scaleY on nodes).
 */
import { useEffect, useRef } from 'react';
import Konva from 'konva';
import { Arrow, Circle, Ellipse, Group, Image as KImage, Line, Rect, Text } from 'react-konva';
import type { Annotation, BlurAnnotation } from '@magpie/format';

export interface ShapeProps {
  a: Annotation;
  bg: HTMLImageElement;
  interactive: boolean;
  hidden?: boolean;
  register: (id: string, node: Konva.Node | null) => void;
  onSelect: (id: string) => void;
  onDragEnd: (id: string, x: number, y: number) => void;
  onDblClick?: (id: string) => void;
}

export function AnnotationNode(props: ShapeProps) {
  const { a, interactive, register, onSelect, onDragEnd } = props;
  const common = {
    id: a.id,
    x: a.x,
    y: a.y,
    rotation: a.rotation,
    opacity: a.style.opacity ?? 1,
    visible: !props.hidden,
    listening: interactive,
    draggable: interactive,
    perfectDrawEnabled: false,
    ref: (n: Konva.Node | null) => register(a.id, n),
    onMouseDown: (e: Konva.KonvaEventObject<MouseEvent>) => {
      if (!interactive) return;
      e.cancelBubble = true;
      onSelect(a.id);
    },
    onDragEnd: (e: Konva.KonvaEventObject<DragEvent>) => onDragEnd(a.id, e.target.x(), e.target.y()),
    onDblClick: () => props.onDblClick?.(a.id),
  };
  const sw = a.style.strokeWidth;

  switch (a.type) {
    case 'arrow':
      return (
        <Arrow
          {...common}
          points={a.data.points}
          stroke={a.style.stroke}
          fill={a.style.stroke}
          strokeWidth={sw}
          pointerLength={Math.max(10, sw * 3)}
          pointerWidth={Math.max(10, sw * 3)}
          lineCap="round"
          lineJoin="round"
          hitStrokeWidth={Math.max(sw, 18)}
        />
      );
    case 'line':
      return <Line {...common} points={a.data.points} stroke={a.style.stroke} strokeWidth={sw} lineCap="round" hitStrokeWidth={Math.max(sw, 18)} />;
    case 'rect':
      return (
        <Rect
          {...common}
          width={a.data.width}
          height={a.data.height}
          cornerRadius={a.data.cornerRadius ?? 0}
          stroke={a.style.stroke}
          strokeWidth={sw}
          fill={a.style.fill}
          strokeScaleEnabled={false}
          hitStrokeWidth={Math.max(sw, 14)}
          fillEnabled={!!a.style.fill}
        />
      );
    case 'ellipse':
      return (
        <Ellipse
          {...common}
          radiusX={a.data.radiusX}
          radiusY={a.data.radiusY}
          stroke={a.style.stroke}
          strokeWidth={sw}
          fill={a.style.fill}
          strokeScaleEnabled={false}
          hitStrokeWidth={Math.max(sw, 14)}
          fillEnabled={!!a.style.fill}
        />
      );
    case 'text':
      return (
        <Text
          {...common}
          text={a.data.text || ' '}
          width={a.data.width}
          fontSize={a.style.fontSize ?? 28}
          fontFamily={a.style.fontFamily ?? 'system-ui, sans-serif'}
          fill={a.style.stroke}
          padding={4}
          lineHeight={1.2}
          wrap="word"
        />
      );
    case 'highlighter':
      return (
        <Line
          {...common}
          points={a.data.points}
          stroke={a.style.stroke}
          strokeWidth={sw}
          lineCap="round"
          lineJoin="round"
          tension={0.3}
          hitStrokeWidth={Math.max(sw, 18)}
        />
      );
    case 'blur':
      return <BlurNode {...props} a={a} common={common} />;
    case 'step': {
      const r = a.data.radius;
      return (
        <Group {...common}>
          <Circle radius={r} fill={a.style.fill ?? '#e5484d'} stroke={a.style.stroke} strokeWidth={a.style.strokeWidth} shadowColor="#000" shadowOpacity={0.25} shadowBlur={4} shadowOffsetY={1} />
          <Text
            text={String(a.data.number)}
            width={r * 2}
            height={r * 2}
            offsetX={r}
            offsetY={r}
            align="center"
            verticalAlign="middle"
            fontSize={Math.round(r * 1.05)}
            fontStyle="bold"
            fontFamily="system-ui, sans-serif"
            fill={a.style.stroke}
            listening={false}
          />
        </Group>
      );
    }
  }
}

/**
 * Blur/pixelate (§7): a cropped copy of the background, filtered and cached.
 * For blur, sample a padded area and clip, so the filter's transparent edge
 * falloff never reveals the original pixels underneath.
 */
function BlurNode({ a, bg, common }: ShapeProps & { a: BlurAnnotation; common: Record<string, unknown> }) {
  const img = useRef<Konva.Image>(null);
  const group = useRef<Konva.Group>(null);
  const { width, height, mode, amount } = a.data;
  const pad = mode === 'blur' ? Math.ceil(amount * 2) : 0;

  const refresh = (gx: number, gy: number) => {
    const node = img.current;
    if (!node) return;
    const sx = Math.max(0, Math.floor(gx - pad));
    const sy = Math.max(0, Math.floor(gy - pad));
    const ex = Math.min(bg.naturalWidth, Math.ceil(gx + width + pad));
    const ey = Math.min(bg.naturalHeight, Math.ceil(gy + height + pad));
    if (ex <= sx || ey <= sy) {
      node.visible(false);
      return;
    }
    node.visible(true);
    node.setAttrs({ x: sx - gx, y: sy - gy, width: ex - sx, height: ey - sy, crop: { x: sx, y: sy, width: ex - sx, height: ey - sy } } as Konva.ImageConfig);
    node.clearCache();
    node.cache({ pixelRatio: 1 });
    node.getLayer()?.batchDraw();
  };

  useEffect(() => {
    refresh(a.x, a.y);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [a.x, a.y, width, height, mode, amount, bg]);

  return (
    <Group
      {...common}
      ref={(n: Konva.Group | null) => {
        group.current = n;
        (common.ref as (n: Konva.Node | null) => void)(n);
      }}
      rotation={0}
      clipX={0}
      clipY={0}
      clipWidth={width}
      clipHeight={height}
      onDragMove={(e: Konva.KonvaEventObject<DragEvent>) => refresh(e.target.x(), e.target.y())}
    >
      <KImage
        ref={img}
        image={bg}
        filters={[mode === 'blur' ? Konva.Filters.Blur : Konva.Filters.Pixelate]}
        blurRadius={amount}
        pixelSize={Math.max(2, Math.round(amount))}
        listening={false}
      />
      {/* Invisible hit area so the clipped group is easy to grab. */}
      <Rect width={width} height={height} fill="rgba(0,0,0,0.001)" />
    </Group>
  );
}
