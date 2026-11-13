import { describe, expect, it } from 'vitest';
import { acceleratorFromEvent, type KeyLike } from '../src/shared/accelerator';
import { parseCli } from '../src/shared/cli';
import {
  boundingBox,
  intersect,
  logicalToFrameRect,
  mapDisplayToOwnFrame,
  mapDisplaysToDesktopImage,
  rectFromPoints,
} from '../src/shared/geometry';

describe('mapDisplaysToDesktopImage (Linux portal frame)', () => {
  it('maps a single 150% display', () => {
    const { maps, ratioX, ratioY } = mapDisplaysToDesktopImage(
      [{ id: '1', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.5 }],
      3840,
      2160,
    );
    expect(ratioX).toBe(1.5);
    expect(ratioY).toBe(1.5);
    expect(maps[0]!.rectPx).toEqual({ x: 0, y: 0, width: 3840, height: 2160 });
  });

  it('maps side-by-side monitors with a negative origin', () => {
    const displays = [
      { id: 'L', bounds: { x: -1920, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
      { id: 'R', bounds: { x: 0, y: 0, width: 2560, height: 1440 }, scaleFactor: 1 },
    ];
    const { maps } = mapDisplaysToDesktopImage(displays, 4480, 1440);
    expect(maps.find((m) => m.id === 'L')!.rectPx).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
    expect(maps.find((m) => m.id === 'R')!.rectPx).toEqual({ x: 1920, y: 0, width: 2560, height: 1440 });
  });

  it('uses the uniform stage scale even when per-display scaleFactors differ', () => {
    // GNOME renders the whole stage at one scale (here 2×) regardless of each monitor's factor.
    const displays = [
      { id: 'A', bounds: { x: 0, y: 0, width: 1280, height: 800 }, scaleFactor: 2 },
      { id: 'B', bounds: { x: 1280, y: 0, width: 1920, height: 1080 }, scaleFactor: 1 },
    ];
    const { maps } = mapDisplaysToDesktopImage(displays, 6400, 2160);
    expect(maps.find((m) => m.id === 'B')!.rectPx).toEqual({ x: 2560, y: 0, width: 3840, height: 2160 });
  });

  it('clamps rects to the image', () => {
    const { maps } = mapDisplaysToDesktopImage([{ id: '1', bounds: { x: 0, y: 0, width: 100, height: 100 }, scaleFactor: 1 }], 99, 99);
    expect(maps[0]!.rectPx.width).toBeLessThanOrEqual(99);
  });
});

describe('logicalToFrameRect', () => {
  const display = { id: 'R', bounds: { x: 1920, y: 0, width: 2560, height: 1440 }, scaleFactor: 1.25, rectPx: { x: 1920, y: 0, width: 3200, height: 1800 } };

  it('scales and offsets into the frame', () => {
    expect(logicalToFrameRect(display, { x: 100, y: 40, width: 200, height: 100 })).toEqual({ x: 2045, y: 50, width: 250, height: 125 });
  });

  it('stays inside the display slice', () => {
    const r = logicalToFrameRect(display, { x: 2500, y: 1400, width: 500, height: 500 });
    expect(r.x + r.width).toBeLessThanOrEqual(1920 + 3200);
    expect(r.y + r.height).toBeLessThanOrEqual(1800);
    expect(r.width).toBeGreaterThan(0);
  });

  it('handles Windows per-display frames', () => {
    const d = mapDisplayToOwnFrame({ id: '2', bounds: { x: 1920, y: 0, width: 1536, height: 864 }, scaleFactor: 1.25 }, 1920, 1080);
    expect(logicalToFrameRect(d, { x: 0, y: 0, width: 1536, height: 864 })).toEqual({ x: 0, y: 0, width: 1920, height: 1080 });
  });
});

describe('rect helpers', () => {
  it('normalizes drags in any direction', () => {
    expect(rectFromPoints(10, 10, 0, 5)).toEqual({ x: 0, y: 5, width: 10, height: 5 });
  });
  it('intersects', () => {
    expect(intersect({ x: 0, y: 0, width: 10, height: 10 }, { x: 5, y: 5, width: 10, height: 10 })).toEqual({ x: 5, y: 5, width: 5, height: 5 });
    expect(intersect({ x: 0, y: 0, width: 1, height: 1 }, { x: 2, y: 2, width: 1, height: 1 })).toBeNull();
  });
  it('bounding box', () => {
    expect(boundingBox([{ x: -5, y: 0, width: 5, height: 5 }, { x: 0, y: 0, width: 10, height: 20 }])).toEqual({ x: -5, y: 0, width: 15, height: 20 });
  });
});

describe('parseCli', () => {
  it('parses --capture forms', () => {
    expect(parseCli(['/usr/bin/magpie', '--capture', 'region']).capture).toBe('region');
    expect(parseCli(['electron', '.', '--capture=window']).capture).toBe('window');
    expect(parseCli(['magpie', '--capture', 'fullscreen']).capture).toBe('full');
    expect(parseCli(['magpie', '--capture', 'bogus']).capture).toBeNull();
  });
  it('recovers the mode from a Chromium-reordered second-instance argv', () => {
    const argv = ['electron', '--no-sandbox', '--capture', '--allow-file-access-from-files', '--ozone-platform=x11', '.', 'region'];
    expect(parseCli(argv).capture).toBe('region');
  });
  it('collects .magpie files and --doctor', () => {
    const c = parseCli(['magpie', '/home/r/Pictures/Magpie/a.magpie', '--doctor', 'other.png']);
    expect(c.open).toEqual(['/home/r/Pictures/Magpie/a.magpie']);
    expect(c.doctor).toBe(true);
  });
});

describe('acceleratorFromEvent', () => {
  const ev = (over: Partial<KeyLike>): KeyLike => ({ key: '', code: '', ctrlKey: false, shiftKey: false, altKey: false, metaKey: false, ...over });
  it('builds accelerators', () => {
    expect(acceleratorFromEvent(ev({ key: 'PrintScreen', code: 'PrintScreen' }))).toBe('PrintScreen');
    expect(acceleratorFromEvent(ev({ key: 'S', code: 'KeyS', ctrlKey: true, shiftKey: true }))).toBe('Control+Shift+S');
    expect(acceleratorFromEvent(ev({ key: '4', code: 'Digit4', metaKey: true, shiftKey: true }))).toBe('Shift+Super+4');
    expect(acceleratorFromEvent(ev({ key: 'F12', code: 'F12', altKey: true }))).toBe('Alt+F12');
  });
  it('ignores bare modifiers', () => {
    expect(acceleratorFromEvent(ev({ key: 'Shift', code: 'ShiftLeft', shiftKey: true }))).toBeNull();
  });
});
