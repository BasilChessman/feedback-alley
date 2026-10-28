import type { Anchor, Block, FixedState, Layer, Project, Rect } from '../types';
import { toOuter } from './tree';

// Fixed-size layers keep their size when their block or group is resized.
//
// Layer geometry is always stored in % of the parent, so the renderer and
// editor tools need no special cases. Instead, after every edit, each fixed
// layer is checked against what it remembers: its size in screen %, plus the
// parent's id and size at that time.
//  - Same parent, parent resized: put the layer back to its remembered size,
//    holding its anchor in place.
//  - Same parent, same size: the layer itself was edited; remember its new size.
//  - Different parent (grouped, pasted, duplicated, template): remember as-is.

const EPS = 1e-6;
const same = (a: number, b: number) => Math.abs(a - b) < EPS;

// The anchor point closest to where a layer sits in its parent.
export function nearestAnchor(r: Rect): { ax: Anchor; ay: Anchor } {
  const pick = (start: number, size: number): Anchor => {
    const c = start + size / 2;
    return c < 100 / 3 ? 0 : c > 200 / 3 ? 1 : 0.5;
  };
  return { ax: pick(r.x, r.w), ay: pick(r.y, r.h) };
}

// Keep the anchored edge's distance from the parent's edge (left/right/top/
// bottom anchors) or the center's relative position (center anchors).
function place(pos: number, size: number, newSize: number, anchor: number, oldParent: number, newParent: number) {
  if (anchor === 0) return (pos * oldParent) / newParent;
  if (anchor === 1) return 100 - newSize - ((100 - pos - size) * oldParent) / newParent;
  return pos + size / 2 - newSize / 2;
}

function syncLayers(layers: Layer[], parent: Rect, parentId: string) {
  for (const l of layers) {
    if (l.sizing === 'fixed') {
      const f = l.fixed;
      const fresh = (): FixedState => ({ w: (l.w * parent.w) / 100, h: (l.h * parent.h) / 100, cw: parent.w, ch: parent.h, c: parentId });
      if (!f || f.c !== parentId) {
        l.fixed = fresh();
      } else if (!same(f.cw, parent.w) || !same(f.ch, parent.h)) {
        // parent resized: restore the remembered size around the anchor
        const w = (f.w / parent.w) * 100;
        const h = (f.h / parent.h) * 100;
        l.x = place(l.x, l.w, w, l.anchorX ?? 0.5, f.cw, parent.w);
        l.y = place(l.y, l.h, h, l.anchorY ?? 0.5, f.ch, parent.h);
        l.w = w;
        l.h = h;
        l.fixed = { ...f, cw: parent.w, ch: parent.h };
      } else if (!same(f.w, (l.w * parent.w) / 100) || !same(f.h, (l.h * parent.h) / 100)) {
        l.fixed = fresh();
      }
    } else if (l.fixed) {
      delete l.fixed;
    }
    if (l.type === 'group') syncLayers(l.layers, toOuter(parent, l), l.id);
  }
}

export function syncBlocks(blocks: Block[]) {
  for (const b of blocks) syncLayers(b.layers, b, b.id);
}

// Run after every edit.
export function syncFixedLayers(p: Project) {
  for (const s of p.screens) syncBlocks(s.blocks);
  for (const t of p.templates) syncBlocks(t.blocks);
}
