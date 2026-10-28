import type { Block, GroupLayer, Layer, Rect } from '../types';

// Anything that holds layers: a block, or a group inside it.
export type Container = { layers: Layer[] };

// Follow a path of group ids down from a block. null if the path is stale.
export function containerAt(block: Block, path: string[]): Container | null {
  let c: Container = block;
  for (const id of path) {
    const g = c.layers.find((l) => l.id === id);
    if (!g || g.type !== 'group') return null;
    c = g;
  }
  return c;
}

export function groupAt(block: Block, path: string[]): GroupLayer | null {
  if (path.length === 0) return null;
  const c = containerAt(block, path);
  return c && 'type' in c ? (c as GroupLayer) : null;
}

// A rect given in % of an inner container, expressed in % of the outer one.
export const toOuter = (outer: Rect, inner: Rect): Rect => ({
  x: outer.x + (inner.x * outer.w) / 100,
  y: outer.y + (inner.y * outer.h) / 100,
  w: (inner.w * outer.w) / 100,
  h: (inner.h * outer.h) / 100,
});

// The inverse: a rect in % of the outer container, in % of the inner one.
export const toInner = (outer: Rect, r: Rect): Rect => ({
  x: ((r.x - outer.x) / outer.w) * 100,
  y: ((r.y - outer.y) / outer.h) * 100,
  w: (r.w / outer.w) * 100,
  h: (r.h / outer.h) * 100,
});

// Screen-% rect of the container at `path` inside `block`.
export function containerRect(block: Block, path: string[]): Rect {
  let rect: Rect = { x: block.x, y: block.y, w: block.w, h: block.h };
  let c: Container = block;
  for (const id of path) {
    const g = c.layers.find((l) => l.id === id) as GroupLayer | undefined;
    if (!g) break;
    rect = toOuter(rect, g);
    c = g;
  }
  return rect;
}

// Path of group ids leading to the container that holds layer `id`.
export function pathTo(layers: Layer[], id: string, path: string[] = []): string[] | null {
  for (const l of layers) {
    if (l.id === id) return path;
    if (l.type === 'group') {
      const p = pathTo(l.layers, id, [...path, l.id]);
      if (p) return p;
    }
  }
  return null;
}

export function findLayer(layers: Layer[], id: string): Layer | null {
  for (const l of layers) {
    if (l.id === id) return l;
    if (l.type === 'group') {
      const f = findLayer(l.layers, id);
      if (f) return f;
    }
  }
  return null;
}

export function countType(layers: Layer[], type: Layer['type']): number {
  return layers.reduce((n, l) => n + (l.type === type ? 1 : 0) + (l.type === 'group' ? countType(l.layers, type) : 0), 0);
}

export function countLayers(layers: Layer[]): number {
  return layers.reduce((n, l) => n + 1 + (l.type === 'group' ? countLayers(l.layers) : 0), 0);
}
