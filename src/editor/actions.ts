import type { Block, GroupLayer, Layer, LayerType, Rect, Screen, Template } from '../types';
import { boundsOf, cloneBlock, cloneLayer, instantiateTemplate, instantiateTemplateAt, newBlock, newLayer, uid } from '../lib/defaults';
import { containerAt, containerRect, countType, toInner, toOuter, type Container } from '../lib/tree';
import { rectPx, scaleLayerStrokes, scaleStrokes, screenPx } from '../lib/pixels';
import { EMPTY_SELECTION, selectBlocks, selectLayers, useEditor } from './EditorCtx';

// Template being dragged from the sidebar (drag events can't read their data until drop).
export const templateDrag = { id: null as string | null };
export const TEMPLATE_MIME = 'application/x-feedback-template';

// In-memory clipboard; survives switching screens within a session.
// pxWidth is the source screen's, so border widths can be scaled to the target screen.
let clipboard: ({ kind: 'blocks'; blocks: Block[] } | { kind: 'layers'; layers: Layer[] }) & { pxWidth: number } | null = null;

export type AlignMode = 'left' | 'hcenter' | 'right' | 'top' | 'vmiddle' | 'bottom';
export type ZMove = 'front' | 'forward' | 'backward' | 'back';

function reorder<T extends { id: string }>(list: T[], ids: string[], move: ZMove) {
  const picked = list.filter((x) => ids.includes(x.id));
  const rest = list.filter((x) => !ids.includes(x.id));
  if (move === 'front') return [...rest, ...picked];
  if (move === 'back') return [...picked, ...rest];
  const out = [...list];
  const order = move === 'forward' ? [...out.keys()].reverse() : [...out.keys()];
  for (const i of order) {
    if (!ids.includes(out[i].id)) continue;
    const j = move === 'forward' ? i + 1 : i - 1;
    if (j < 0 || j >= out.length || ids.includes(out[j].id)) continue;
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

function alignRects(rects: Rect[], mode: AlignMode, to: Rect) {
  for (const r of rects) {
    if (mode === 'left') r.x = to.x;
    if (mode === 'hcenter') r.x = to.x + (to.w - r.w) / 2;
    if (mode === 'right') r.x = to.x + to.w - r.w;
    if (mode === 'top') r.y = to.y;
    if (mode === 'vmiddle') r.y = to.y + (to.h - r.h) / 2;
    if (mode === 'bottom') r.y = to.y + to.h - r.h;
  }
}

function distributeRects(items: Rect[], axis: 'x' | 'y') {
  if (items.length < 3) return;
  const pos = axis;
  const size = axis === 'x' ? 'w' : 'h';
  const sorted = [...items].sort((a, b) => a[pos] - b[pos]);
  const bb = boundsOf(sorted);
  const total = sorted.reduce((t, i) => t + i[size], 0);
  const gap = (bb[size] - total) / (sorted.length - 1);
  let cur = bb[pos];
  for (const i of sorted) {
    i[pos] = cur;
    cur += i[size] + gap;
  }
}

const FULL: Rect = { x: 0, y: 0, w: 100, h: 100 };

export function useActions() {
  const { screen, sel, setSel, updateScreen, mutate } = useEditor();
  const layerMode = !!sel.focus;
  const hasLayers = layerMode && sel.layers.length > 0;
  // The block or group whose layers are currently being edited.
  const container = (s: Screen): Container | null => {
    const b = s.blocks.find((b) => b.id === sel.focus);
    return b ? containerAt(b, sel.path) : null;
  };
  const selectedLayers = (s: Screen) => container(s)?.layers.filter((l) => sel.layers.includes(l.id)) ?? [];

  return {
    addBlock() {
      // cascade new blocks so they don't land exactly on top of each other
      const n = screen.blocks.length % 8;
      const b = newBlock({ x: 10 + n * 3, y: 10 + n * 3, name: `Block ${screen.blocks.length + 1}` });
      updateScreen((s) => s.blocks.push(b));
      setSel(selectBlocks([b.id]));
    },

    // Adds into the container being edited (block or group), or into the selected block.
    addLayer(type: LayerType, blockId = sel.focus ?? sel.blocks[0], path = blockId === sel.focus ? sel.path : []) {
      if (!blockId) return;
      const l = newLayer(type);
      updateScreen((s) => {
        const b = s.blocks.find((b) => b.id === blockId)!;
        const c = containerAt(b, path);
        if (!c) return;
        // numbered across the whole block so nested items don't repeat names
        l.name = `${l.name} ${countType(b.layers, type) + 1}`;
        c.layers.push(l);
      });
      setSel(selectLayers(blockId, path, [l.id]));
    },

    // Wrap the selected layers in a new group sized to fit them. Positions are
    // converted so nothing moves on screen.
    group() {
      if (!hasLayers) return;
      const g = newLayer('group') as GroupLayer;
      updateScreen((s) => {
        const c = container(s);
        if (!c) return;
        const picked = c.layers.filter((l) => sel.layers.includes(l.id));
        if (!picked.length) return;
        const bb = boundsOf(picked);
        const block = s.blocks.find((b) => b.id === sel.focus)!;
        Object.assign(g, bb, { name: `Group ${countType(block.layers, 'group') + 1}` });
        g.layers = picked.map((l) => ({ ...l, ...toInner(bb, l) }));
        const at = Math.max(...picked.map((l) => c.layers.indexOf(l))) - picked.length + 1;
        c.layers = c.layers.filter((l) => !sel.layers.includes(l.id));
        c.layers.splice(at, 0, g);
      });
      setSel({ ...sel, layers: [g.id] });
    },

    // Replace selected groups with their children, keeping on-screen positions.
    // The group's own background, border and rules go away with it.
    // Defaults to the current selection; the inspector passes an explicit group.
    ungroup(target?: { path: string[]; ids: string[] }) {
      const blockId = sel.focus;
      const path = target?.path ?? sel.path;
      const ids = target?.ids ?? sel.layers;
      if (!blockId || !ids.length) return;
      const released: string[] = [];
      updateScreen((s) => {
        const c = containerAt(s.blocks.find((b) => b.id === blockId)!, path);
        if (!c) return;
        const out: Layer[] = [];
        for (const l of c.layers) {
          if (l.type === 'group' && ids.includes(l.id)) {
            for (const child of l.layers) {
              out.push({ ...child, ...toOuter(l, child) });
              released.push(child.id);
            }
          } else out.push(l);
        }
        c.layers = out;
      });
      if (released.length) setSel(selectLayers(blockId, path, released));
    },

    enterGroup(id: string) {
      if (!sel.focus) return;
      setSel({ ...sel, path: [...sel.path, id], layers: [] });
    },

    // Step out one level: group -> its parent (keeping the group selected) -> block -> nothing.
    exitLevel() {
      if (sel.layers.length) return setSel({ ...sel, layers: [] });
      if (sel.path.length) return setSel({ ...sel, path: sel.path.slice(0, -1), layers: [sel.path[sel.path.length - 1]] });
      if (sel.focus) return setSel(selectBlocks([sel.focus]));
      setSel(EMPTY_SELECTION);
    },

    deleteSelection() {
      if (layerMode) {
        if (!hasLayers) return;
        updateScreen((s) => {
          const c = container(s);
          if (c) c.layers = c.layers.filter((l) => !sel.layers.includes(l.id));
        });
        setSel({ ...sel, layers: [] });
      } else if (sel.blocks.length) {
        updateScreen((s) => (s.blocks = s.blocks.filter((b) => !sel.blocks.includes(b.id))));
        setSel(EMPTY_SELECTION);
      }
    },

    duplicateSelection() {
      if (layerMode) {
        if (!hasLayers) return;
        const ids: string[] = [];
        updateScreen((s) => {
          const c = container(s);
          if (!c) return;
          for (const l of c.layers.filter((l) => sel.layers.includes(l.id))) {
            const copy = cloneLayer(l);
            copy.name += ' copy';
            ids.push(copy.id);
            c.layers.splice(c.layers.indexOf(l) + 1, 0, copy);
          }
        });
        setSel({ ...sel, layers: ids });
      } else if (sel.blocks.length) {
        const ids: string[] = [];
        updateScreen((s) => {
          for (const b of s.blocks.filter((b) => sel.blocks.includes(b.id))) {
            const c = cloneBlock(b);
            c.x = Math.min(c.x + 2, 100 - c.w);
            c.y = Math.min(c.y + 2, 100 - c.h);
            c.name += ' copy';
            ids.push(c.id);
            s.blocks.push(c);
          }
        });
        setSel(selectBlocks(ids));
      }
    },

    copy() {
      if (hasLayers) clipboard = { kind: 'layers', layers: structuredClone(selectedLayers(screen)), pxWidth: screenPx(screen).w };
      else if (!layerMode && sel.blocks.length) {
        clipboard = { kind: 'blocks', blocks: structuredClone(screen.blocks.filter((b) => sel.blocks.includes(b.id))), pxWidth: screenPx(screen).w };
      }
    },

    // Layers paste into the container being edited, or into the single selected block.
    paste() {
      if (!clipboard) return;
      if (clipboard.kind === 'layers') {
        const target = sel.focus ?? (sel.blocks.length === 1 ? sel.blocks[0] : null);
        if (!target) return;
        const path = sel.focus ? sel.path : [];
        const layers = clipboard.layers.map(cloneLayer);
        scaleLayerStrokes(layers, screenPx(screen).w / clipboard.pxWidth);
        updateScreen((s) => containerAt(s.blocks.find((b) => b.id === target)!, path)?.layers.push(...layers));
        setSel(selectLayers(target, path, layers.map((l) => l.id)));
      } else {
        const blocks = clipboard.blocks.map(cloneBlock);
        scaleStrokes(blocks, screenPx(screen).w / clipboard.pxWidth);
        updateScreen((s) => s.blocks.push(...blocks));
        setSel(selectBlocks(blocks.map((b) => b.id)));
      }
    },

    // dx/dy in % of the container, or in its pixels with `px` (landing on whole pixels).
    nudge(dx: number, dy: number, px = false) {
      updateScreen((s) => {
        const items: Rect[] = layerMode ? selectedLayers(s) : s.blocks.filter((b) => sel.blocks.includes(b.id));
        const focus = layerMode ? s.blocks.find((b) => b.id === sel.focus) : undefined;
        const frame = focus ? rectPx(s, containerRect(focus, sel.path)) : screenPx(s);
        for (const r of items) {
          if (px) {
            r.x = (Math.round((r.x / 100) * frame.w + dx) / frame.w) * 100;
            r.y = (Math.round((r.y / 100) * frame.h + dy) / frame.h) * 100;
          } else {
            r.x = Math.round((r.x + dx) * 100) / 100;
            r.y = Math.round((r.y + dy) * 100) / 100;
          }
        }
      });
    },

    zOrder(move: ZMove) {
      updateScreen((s) => {
        if (layerMode) {
          const c = container(s);
          if (c) c.layers = reorder(c.layers, sel.layers, move);
        } else {
          s.blocks = reorder(s.blocks, sel.blocks, move);
        }
      });
    },

    // One item aligns to its parent (screen, block or group); several align to their shared bounds.
    align(mode: AlignMode) {
      updateScreen((s) => {
        const items: Rect[] = layerMode ? selectedLayers(s) : s.blocks.filter((b) => sel.blocks.includes(b.id));
        alignRects(items, mode, items.length > 1 ? boundsOf(items) : FULL);
      });
    },

    distribute(axis: 'x' | 'y') {
      updateScreen((s) => distributeRects(layerMode ? selectedLayers(s) : s.blocks.filter((b) => sel.blocks.includes(b.id)), axis));
    },

    saveTemplate(name: string) {
      const blocks = screen.blocks.filter((b) => sel.blocks.includes(b.id));
      if (!blocks.length) return;
      const t: Template = {
        id: uid(),
        name,
        sourceAspect: screen.aspectW / screen.aspectH,
        sourcePxWidth: screenPx(screen).w,
        blocks: structuredClone(blocks),
        createdAt: new Date().toISOString(),
      };
      mutate((p) => p.templates.push(t));
    },

    // Without a point: same position it was saved at. With a point: centered there.
    insertTemplate(t: Template, at?: { x: number; y: number }) {
      const blocks = at ? instantiateTemplateAt(t, screen, at.x, at.y) : instantiateTemplate(t, screen);
      updateScreen((s) => s.blocks.push(...blocks));
      setSel(selectBlocks(blocks.map((b) => b.id)));
    },
  };
}
