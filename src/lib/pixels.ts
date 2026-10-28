import type { Block, Layer, Rect, Screen } from '../types';

// Screens are laid out in % so they scale to any output. Each screen also has a
// design size in pixels (e.g. 1920×1080), used to show and type positions in
// px, and as the unit for border widths and corner radii.
export const DEFAULT_PX_WIDTH = 1920;

export function screenPx(s: Pick<Screen, 'pxWidth' | 'aspectW' | 'aspectH'>) {
  const w = s.pxWidth || DEFAULT_PX_WIDTH;
  return { w, h: Math.round((w * s.aspectH) / s.aspectW) };
}

// Pixel size of a screen-% rect.
export const rectPx = (s: Screen, r: Rect) => {
  const px = screenPx(s);
  return { w: (r.w / 100) * px.w, h: (r.h / 100) * px.h };
};

// Round a rect (in % of a frame of fw×fh px) to whole pixels of that frame.
export function roundRectPx(r: Rect, fw: number, fh: number): Rect {
  const rx = (v: number) => (Math.round((v / 100) * fw) / fw) * 100;
  const ry = (v: number) => (Math.round((v / 100) * fh) / fh) * 100;
  return { x: rx(r.x), y: ry(r.y), w: Math.max(rx(r.w), 100 / fw), h: Math.max(ry(r.h), 100 / fh) };
}

// Border widths and radii are in screen px. When blocks move to a screen with a
// different pixel width (or the width changes), scale them so they look the same.
export function scaleStrokes(blocks: Block[], k: number) {
  if (!isFinite(k) || k === 1) return;
  const r2 = (n: number) => Math.round(n * k * 100) / 100;
  const layers = (ls: Layer[]) => {
    for (const l of ls) {
      l.radius = r2(l.radius);
      if (l.type === 'shape' || l.type === 'group') l.borderWidth = r2(l.borderWidth);
      if (l.type === 'group') layers(l.layers);
    }
  };
  for (const b of blocks) {
    b.borderWidth = r2(b.borderWidth);
    b.radius = r2(b.radius);
    layers(b.layers);
  }
}

export function scaleLayerStrokes(ls: Layer[], k: number) {
  scaleStrokes([{ borderWidth: 0, radius: 0, layers: ls } as unknown as Block], k);
}
