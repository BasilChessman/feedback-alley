import type { Rect } from '../types';

export interface Guide {
  axis: 'x' | 'y';
  pos: number; // % of frame
}

export type Handle = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
export const HANDLES: Handle[] = ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'];

const MIN_SIZE = 0.5;

function nearest(cands: number[], targets: number[], thr: number) {
  let best: { delta: number; pos: number } | null = null;
  for (const c of cands) {
    for (const t of targets) {
      const d = t - c;
      if (Math.abs(d) <= thr && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, pos: t };
    }
  }
  return best;
}

function targets(others: Rect[]) {
  const xs = [0, 50, 100];
  const ys = [0, 50, 100];
  for (const o of others) {
    xs.push(o.x, o.x + o.w / 2, o.x + o.w);
    ys.push(o.y, o.y + o.h / 2, o.y + o.h);
  }
  return { xs, ys };
}

const roundTo = (v: number, step: number) => (step > 0 ? Math.round(v / step) * step : v);

export interface SnapOpts {
  others: Rect[];
  thrX: number; // snap distance in % of frame width
  thrY: number;
  snap: boolean;
  gridX: number; // grid step in % of frame width (used while snapping), 0 = off
  gridY: number;
  stepX?: number; // always land on multiples of this (e.g. one pixel), 0 = off
  stepY?: number;
}

// Snap a moving group (its bounding box) to edges/centers of other items, or to the grid.
export function snapMove(bb: Rect, dx: number, dy: number, o: SnapOpts) {
  const guides: Guide[] = [];
  let x = bb.x + dx;
  let y = bb.y + dy;
  if (o.snap) {
    const t = targets(o.others);
    const sx = nearest([x, x + bb.w / 2, x + bb.w], t.xs, o.thrX);
    const sy = nearest([y, y + bb.h / 2, y + bb.h], t.ys, o.thrY);
    if (sx) { x += sx.delta; guides.push({ axis: 'x', pos: sx.pos }); }
    else if (o.gridX > 0) x = roundTo(x, o.gridX);
    if (sy) { y += sy.delta; guides.push({ axis: 'y', pos: sy.pos }); }
    else if (o.gridY > 0) y = roundTo(y, o.gridY);
  }
  x = roundTo(x, o.stepX ?? 0);
  y = roundTo(y, o.stepY ?? 0);
  return { dx: x - bb.x, dy: y - bb.y, guides };
}

// Resize one rect by dragging a handle. keepAspect uses the frame's pixel size
// so "square" means square on screen, not square in percentages.
export function resizeRect(start: Rect, handle: Handle, dx: number, dy: number, o: SnapOpts & { keepAspect: boolean; frameW: number; frameH: number }) {
  const guides: Guide[] = [];
  let left = start.x;
  let top = start.y;
  let right = start.x + start.w;
  let bottom = start.y + start.h;
  const hasN = handle.includes('n');
  const hasS = handle.includes('s');
  const hasE = handle.includes('e');
  const hasW = handle.includes('w');
  if (hasE) right += dx;
  if (hasW) left += dx;
  if (hasS) bottom += dy;
  if (hasN) top += dy;

  const t = o.snap ? targets(o.others) : null;
  const snapEdge = (v: number, axis: 'x' | 'y') => {
    if (!t) return v;
    const s = nearest([v], axis === 'x' ? t.xs : t.ys, axis === 'x' ? o.thrX : o.thrY);
    if (s) { guides.push({ axis, pos: s.pos }); return v + s.delta; }
    return roundTo(v, axis === 'x' ? o.gridX : o.gridY);
  };
  if (!o.keepAspect) {
    if (hasE) right = snapEdge(right, 'x');
    if (hasW) left = snapEdge(left, 'x');
    if (hasS) bottom = snapEdge(bottom, 'y');
    if (hasN) top = snapEdge(top, 'y');
    const sx = o.stepX ?? 0;
    const sy = o.stepY ?? 0;
    if (hasE) right = roundTo(right, sx);
    if (hasW) left = roundTo(left, sx);
    if (hasS) bottom = roundTo(bottom, sy);
    if (hasN) top = roundTo(top, sy);
  }

  if (right - left < MIN_SIZE) hasW ? (left = right - MIN_SIZE) : (right = left + MIN_SIZE);
  if (bottom - top < MIN_SIZE) hasN ? (top = bottom - MIN_SIZE) : (bottom = top + MIN_SIZE);

  if (o.keepAspect) {
    const ratio = (start.w * o.frameW) / (start.h * o.frameH); // px aspect
    let w = right - left;
    let h = bottom - top;
    if (hasN || hasS) {
      if (hasE || hasW) {
        // corner: follow whichever axis moved more
        const hFromW = (w * o.frameW) / ratio / o.frameH;
        if (hFromW > h) h = hFromW;
        else w = (h * o.frameH * ratio) / o.frameW;
      } else {
        w = (h * o.frameH * ratio) / o.frameW;
      }
    } else {
      h = (w * o.frameW) / ratio / o.frameH;
    }
    if (hasW) left = right - w; else if (!hasE) left = start.x + (start.w - w) / 2;
    if (hasN) top = bottom - h; else if (!hasS) top = start.y + (start.h - h) / 2;
    right = left + w;
    bottom = top + h;
  }

  return { rect: { x: left, y: top, w: right - left, h: bottom - top }, guides };
}

export function intersects(a: Rect, b: Rect) {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}
