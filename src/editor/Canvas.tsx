import { useEffect, useLayoutEffect, useRef, useState, type DragEvent, type PointerEvent as RPointerEvent } from 'react';
import type { Layer, Rect, Settings } from '../types';
import { activeHeader, headerRects, HEADER_MAX, HEADER_MIN } from '../lib/header';
import { rectPx, screenPx } from '../lib/pixels';
import { ScreenView } from '../render/ScreenView';
import { boundsOf, instantiateTemplateAt } from '../lib/defaults';
import { templateDrag, TEMPLATE_MIME, useActions } from './actions';
import { containerAt, containerRect, groupAt } from '../lib/tree';
import { selectBlocks, selectLayers } from './EditorCtx';
import { useEditor } from './EditorCtx';
import { HANDLES, intersects, resizeRect, snapMove, type Guide, type Handle } from './snap';

const SNAP_PX = 6;
const PAD = 28;
export const MIN_ZOOM = 0.1;
export const MAX_ZOOM = 8;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

// The screen is rendered at (fit size × zoom) pixels inside a scrollable area,
// so zooming re-lays-out the real content instead of magnifying a bitmap.
export function Canvas() {
  const { screen, project, values, sel, setSel, zoom, setZoom } = useEditor();
  const wrapRef = useRef<HTMLDivElement>(null);
  // outer = size including scrollbars (drives the fit size, so scrollbars appearing
  // while zoomed don't change it); w/h = visible client area (drives centering).
  const [view, setView] = useState({ w: 0, h: 0, outerW: 0, outerH: 0 });
  // Point (in viewport coordinates) that should stay put across the next zoom change.
  const anchor = useRef<{ x: number; y: number } | null>(null);
  const zoomRef = useRef(zoom);
  zoomRef.current = zoom;

  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const measure = () => setView({ w: el.clientWidth, h: el.clientHeight, outerW: el.offsetWidth, outerH: el.offsetHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const aspect = screen.aspectW / screen.aspectH;
  const fitW = Math.max(0, Math.min(view.outerW - PAD * 2, (view.outerH - PAD * 2) * aspect));
  const w = Math.floor(fitW * zoom);
  const h = Math.floor(w / aspect);
  const contentW = Math.max(view.w, w + PAD * 2);
  const contentH = Math.max(view.h, h + PAD * 2);
  const ox = (contentW - w) / 2;
  const oy = (contentH - h) / 2;

  // Keep the anchored point (pointer, or viewport center for toolbar zooms) fixed.
  const last = useRef({ w, h, ox, oy });
  useLayoutEffect(() => {
    const el = wrapRef.current!;
    const prev = last.current;
    if (prev.w > 0 && prev.w !== w) {
      const a = anchor.current ?? { x: el.clientWidth / 2, y: el.clientHeight / 2 };
      const u = (el.scrollLeft + a.x - prev.ox) / prev.w;
      const v = (el.scrollTop + a.y - prev.oy) / prev.h;
      el.scrollLeft = u * w + ox - a.x;
      el.scrollTop = v * h + oy - a.y;
    }
    anchor.current = null;
    last.current = { w, h, ox, oy };
  }, [w, h, ox, oy]);

  // Pinch (trackpad) and Ctrl/⌘ + wheel (mouse). Safari reports pinches as gesture events.
  useEffect(() => {
    const el = wrapRef.current!;
    const local = (cx: number, cy: number) => {
      const r = el.getBoundingClientRect();
      return { x: cx - r.left, y: cy - r.top };
    };
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return; // plain scroll / two-finger swipe pans
      e.preventDefault();
      const delta = Math.max(-60, Math.min(60, e.deltaMode === 1 ? e.deltaY * 20 : e.deltaY));
      anchor.current = local(e.clientX, e.clientY);
      setZoom(clampZoom(zoomRef.current * Math.exp(-delta * 0.006)));
    };
    let gestureStart = 1;
    type GestureEvent = UIEvent & { scale: number; clientX: number; clientY: number };
    const onGestureStart = (e: Event) => {
      e.preventDefault();
      gestureStart = zoomRef.current;
    };
    const onGestureChange = (e: Event) => {
      const g = e as GestureEvent;
      e.preventDefault();
      anchor.current = local(g.clientX, g.clientY);
      setZoom(clampZoom(gestureStart * g.scale));
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    el.addEventListener('gesturestart', onGestureStart);
    el.addEventListener('gesturechange', onGestureChange);
    return () => {
      el.removeEventListener('wheel', onWheel);
      el.removeEventListener('gesturestart', onGestureStart);
      el.removeEventListener('gesturechange', onGestureChange);
    };
  }, [setZoom]);

  // Template drag-and-drop from the sidebar: show where the group will land, drop to insert.
  const { insertTemplate } = useActions();
  const stageRef = useRef<HTMLDivElement>(null);
  const [dropPreview, setDropPreview] = useState<{ rects: Rect[]; guides: Guide[]; at: { x: number; y: number } } | null>(null);
  const dropTarget = (e: DragEvent) => {
    const t = project.templates.find((t) => t.id === templateDrag.id);
    const stage = stageRef.current;
    if (!t || !stage || !e.dataTransfer.types.includes(TEMPLATE_MIME)) return null;
    const r = stage.getBoundingClientRect();
    let at = { x: ((e.clientX - r.left) / r.width) * 100, y: ((e.clientY - r.top) / r.height) * 100 };
    let rects: Rect[] = instantiateTemplateAt(t, screen, at.x, at.y);
    // snap the dropped group to other blocks just like a move
    const s = snapMove(boundsOf(rects), 0, 0, {
      others: screen.blocks, thrX: (SNAP_PX / r.width) * 100, thrY: (SNAP_PX / r.height) * 100,
      snap: project.settings.snap && !e.altKey, ...gridOpts(project.settings, screenPx(screen)),
    });
    at = { x: at.x + s.dx, y: at.y + s.dy };
    rects = rects.map((b) => ({ x: b.x + s.dx, y: b.y + s.dy, w: b.w, h: b.h }));
    return { t, at, rects, guides: s.guides };
  };
  const dragHandlers = {
    onDragOver: (e: DragEvent) => {
      const d = dropTarget(e);
      if (!d) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      setDropPreview({ rects: d.rects, guides: d.guides, at: d.at });
    },
    onDragLeave: (e: DragEvent) => {
      if (!(e.currentTarget as HTMLElement).contains(e.relatedTarget as Node)) setDropPreview(null);
    },
    onDrop: (e: DragEvent) => {
      const d = dropTarget(e);
      setDropPreview(null);
      if (!d) return;
      e.preventDefault();
      insertTemplate(d.t, d.at);
    },
  };

  // Pan with Space+drag or middle-button drag.
  const [spaceHeld, setSpaceHeld] = useState(false);
  const [panning, setPanning] = useState(false);
  useEffect(() => {
    const typing = (e: KeyboardEvent) => (e.target as HTMLElement).closest('input, textarea, select, [contenteditable]');
    const down = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e)) {
        e.preventDefault();
        setSpaceHeld(true);
      }
    };
    const up = (e: KeyboardEvent) => e.code === 'Space' && setSpaceHeld(false);
    const blur = () => setSpaceHeld(false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);
    window.addEventListener('blur', blur);
    return () => {
      window.removeEventListener('keydown', down);
      window.removeEventListener('keyup', up);
      window.removeEventListener('blur', blur);
    };
  }, []);

  const startPan = (e: RPointerEvent) => {
    if (!(spaceHeld || e.button === 1)) return;
    e.preventDefault();
    e.stopPropagation();
    const el = wrapRef.current!;
    const x0 = e.clientX + el.scrollLeft;
    const y0 = e.clientY + el.scrollTop;
    setPanning(true);
    const move = (ev: PointerEvent) => {
      el.scrollLeft = x0 - ev.clientX;
      el.scrollTop = y0 - ev.clientY;
    };
    const up = () => {
      setPanning(false);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const focusBlock = sel.focus ? screen.blocks.find((b) => b.id === sel.focus) : undefined;
  const modeLabel = focusBlock
    ? `Editing layers of ${[focusBlock.name, ...sel.path.map((_, i) => groupAt(focusBlock, sel.path.slice(0, i + 1))?.name ?? '?')].join(' › ')} — Esc to step out`
    : '';

  return (
    <div
      ref={wrapRef}
      className={`canvas-wrap${spaceHeld ? ' pan-ready' : ''}${panning ? ' panning' : ''}`}
      {...dragHandlers}
      onPointerDownCapture={startPan}
      onPointerDown={(e) => {
        // clicks on the area around the screen clear the selection
        if (e.target === e.currentTarget || (e.target as HTMLElement).classList.contains('canvas-content')) {
          setSel(selectBlocks([]));
        }
      }}
    >
      <div className="canvas-content" style={{ width: contentW, height: contentH }}>
        {w > 0 && (
          <div ref={stageRef} className="canvas-stage" style={{ left: ox, top: oy, width: w, height: h }}>
            <ScreenView screen={screen} width={w} values={values} settings={project.settings} editing />
            <Overlay width={w} height={h} />
            {dropPreview && (
              <div className="drop-preview">
                {dropPreview.rects.map((r, i) => (
                  <div key={i} className="drop-rect" style={{ left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%` }} />
                ))}
                {dropPreview.guides.map((g, i) => (
                  <div key={i} className={`guide guide-${g.axis}`} style={g.axis === 'x' ? { left: `${g.pos}%` } : { top: `${g.pos}%` }} />
                ))}
              </div>
            )}
            {sel.focus
              ? <div className="mode-badge">{modeLabel}</div>
              : <div className="screen-label">{screen.name} · {screen.aspectW}:{screen.aspectH} · {screenPx(screen).w}×{screenPx(screen).h}px</div>}
          </div>
        )}
      </div>
    </div>
  );
}

// Grid and rounding steps in % of a frame of the given pixel size. In px mode,
// dragging always lands on whole pixels and the grid is in pixels.
function gridOpts(settings: Settings, frame: { w: number; h: number }) {
  if (settings.units !== 'px') return { gridX: settings.grid, gridY: settings.grid };
  const g = settings.gridPx || 0;
  return { gridX: (g / frame.w) * 100, gridY: (g / frame.h) * 100, stepX: 100 / frame.w, stepY: 100 / frame.h };
}

function Overlay({ width, height }: { width: number; height: number }) {
  const { screen, project, sel, setSel, beginGesture, updateScreen } = useEditor();
  const { enterGroup, exitLevel } = useActions();
  const [guides, setGuides] = useState<Guide[]>([]);
  const [marquee, setMarquee] = useState<Rect | null>(null);

  // In layer mode the "frame" is the block or group being edited; otherwise it's the whole screen.
  const focus = sel.focus ? screen.blocks.find((b) => b.id === sel.focus) ?? null : null;
  const container = focus ? containerAt(focus, sel.path) : null;
  const fr = focus ? containerRect(focus, sel.path) : { x: 0, y: 0, w: 100, h: 100 };
  const frame = { left: (fr.x / 100) * width, top: (fr.y / 100) * height, w: (fr.w / 100) * width, h: (fr.h / 100) * height };
  const items: (Rect & { id: string; name: string; type?: string })[] = focus ? container?.layers ?? [] : screen.blocks;
  const selected = focus ? sel.layers : sel.blocks;

  const select = (ids: string[]) => setSel(focus ? { ...sel, layers: ids } : selectBlocks(ids));

  // Drag a layer's header divider: the header's size follows the pointer.
  const onDividerDown = (e: RPointerEvent<HTMLSpanElement>, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const box = (e.currentTarget.parentElement as HTMLElement).getBoundingClientRect();
    beginGesture();
    const move = (ev: PointerEvent) => {
      updateScreen((s) => {
        const b = focus && s.blocks.find((x) => x.id === focus.id);
        const l = b && containerAt(b, sel.path)?.layers.find((x) => x.id === id);
        const h = l?.header;
        if (!h) return;
        const fx = ((ev.clientX - box.left) / box.width) * 100;
        const fy = ((ev.clientY - box.top) / box.height) * 100;
        const size = h.side === 'top' ? fy : h.side === 'bottom' ? 100 - fy : h.side === 'left' ? fx : 100 - fx;
        h.size = Math.round(Math.max(HEADER_MIN, Math.min(HEADER_MAX, size)) * 10) / 10;
      }, true);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const writeRects = (rects: Map<string, Rect>) => {
    updateScreen((s) => {
      const list: (Rect & { id: string })[] = focus
        ? containerAt(s.blocks.find((b) => b.id === focus.id)!, sel.path)?.layers ?? []
        : s.blocks;
      for (const item of list) {
        const r = rects.get(item.id);
        if (r) Object.assign(item, r);
      }
    }, true);
  };

  const drag = (e: RPointerEvent, onMove: (dx: number, dy: number, ev: PointerEvent) => void, onEnd?: (moved: boolean) => void) => {
    const x0 = e.clientX;
    const y0 = e.clientY;
    let moved = false;
    const move = (ev: PointerEvent) => {
      if (!moved) {
        if (Math.hypot(ev.clientX - x0, ev.clientY - y0) < 3) return;
        moved = true;
      }
      onMove(((ev.clientX - x0) / frame.w) * 100, ((ev.clientY - y0) / frame.h) * 100, ev);
    };
    const up = () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      setGuides([]);
      onEnd?.(moved);
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  const snapOpts = (ids: string[], ev: PointerEvent) => ({
    others: items.filter((i) => !ids.includes(i.id)),
    thrX: (SNAP_PX / frame.w) * 100,
    thrY: (SNAP_PX / frame.h) * 100,
    snap: project.settings.snap && !ev.altKey,
    ...gridOpts(project.settings, rectPx(screen, fr)),
  });

  const onItemDown = (e: RPointerEvent, id: string) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    let ids: string[];
    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      ids = selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id];
      select(ids);
      if (!ids.includes(id)) return;
    } else {
      ids = selected.includes(id) ? selected : [id];
      select(ids);
    }
    const starts = new Map(items.filter((i) => ids.includes(i.id)).map((i) => [i.id, { x: i.x, y: i.y, w: i.w, h: i.h }]));
    const bb = boundsOf([...starts.values()]);
    let began = false;
    drag(e, (dx, dy, ev) => {
      if (!began) { began = true; beginGesture(); }
      const s = snapMove(bb, dx, dy, snapOpts(ids, ev));
      setGuides(s.guides);
      writeRects(new Map([...starts].map(([k, r]) => [k, { ...r, x: r.x + s.dx, y: r.y + s.dy }])));
    });
  };

  const onHandleDown = (e: RPointerEvent, id: string, handle: Handle) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    const item = items.find((i) => i.id === id)!;
    const start = { x: item.x, y: item.y, w: item.w, h: item.h };
    let began = false;
    drag(e, (dx, dy, ev) => {
      if (!began) { began = true; beginGesture(); }
      const r = resizeRect(start, handle, dx, dy, { ...snapOpts([id], ev), keepAspect: ev.shiftKey, frameW: frame.w, frameH: frame.h });
      setGuides(r.guides);
      writeRects(new Map([[id, r.rect]]));
    });
  };

  // Empty space: marquee-select inside the frame. In layer mode, a click outside
  // the frame steps out one level (group -> parent -> block).
  const onBackgroundDown = (e: RPointerEvent) => {
    if (e.button !== 0) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const px = e.clientX - rect.left - frame.left;
    const py = e.clientY - rect.top - frame.top;
    const inside = px >= 0 && px <= frame.w && py >= 0 && py <= frame.h;
    if (focus && !inside) {
      if (sel.path.length) setSel({ ...sel, path: sel.path.slice(0, -1), layers: [sel.path[sel.path.length - 1]] });
      else setSel(selectBlocks([focus.id]));
      return;
    }
    const sx = (px / frame.w) * 100;
    const sy = (py / frame.h) * 100;
    const additive = e.shiftKey || e.metaKey;
    const base = additive ? selected : [];
    drag(
      e,
      (dx, dy) => {
        const m = { x: Math.min(sx, sx + dx), y: Math.min(sy, sy + dy), w: Math.abs(dx), h: Math.abs(dy) };
        setMarquee(m);
        select([...new Set([...base, ...items.filter((i) => intersects(i, m)).map((i) => i.id)])]);
      },
      (moved) => {
        setMarquee(null);
        if (!moved && !additive) select([]);
      },
    );
  };

  return (
    <div className="overlay" onPointerDown={onBackgroundDown}>
      {focus && sel.path.length > 0 && (
        // the block itself, so it's clear which block this group lives in
        <div className="frame-parent" style={{ left: `${focus.x}%`, top: `${focus.y}%`, width: `${focus.w}%`, height: `${focus.h}%` }} />
      )}
      <div
        className={`frame${focus ? ' focused' : ''}${sel.path.length ? ' in-group' : ''}`}
        style={{ left: frame.left, top: frame.top, width: frame.w, height: frame.h }}
      >
        {items.map((item) => {
          const isSel = selected.includes(item.id);
          const isGroup = item.type === 'group';
          return (
            <div
              key={item.id}
              className={`hit${isSel ? ' selected' : ''}${isGroup ? ' group' : ''}`}
              style={{ left: `${item.x}%`, top: `${item.y}%`, width: `${item.w}%`, height: `${item.h}%` }}
              onPointerDown={(e) => onItemDown(e, item.id)}
              onDoubleClick={(e) => {
                e.stopPropagation();
                if (!focus) setSel(selectLayers(item.id, [], []));
                else if (isGroup) enterGroup(item.id);
              }}
            >
              {isSel && selected.length === 1 && (
                <>
                  <span className="hit-label">{isGroup ? `▣ ${item.name}` : item.name}</span>
                  {HANDLES.map((h) => (
                    <span key={h} className={`handle h-${h}`} onPointerDown={(e) => onHandleDown(e, item.id, h)} />
                  ))}
                  {(() => {
                    const header = focus && activeHeader(item as Layer);
                    if (!header) return null;
                    const r = headerRects(header).header;
                    const horizontal = header.side === 'top' || header.side === 'bottom';
                    const at = header.side === 'top' ? r.h : header.side === 'bottom' ? r.y : header.side === 'left' ? r.w : r.x;
                    return (
                      <span
                        className={`header-divider ${horizontal ? 'horizontal' : 'vertical'}`}
                        style={horizontal ? { top: `${at}%` } : { left: `${at}%` }}
                        title="Drag to resize the header"
                        onPointerDown={(e) => onDividerDown(e, item.id)}
                      />
                    );
                  })()}
                </>
              )}
            </div>
          );
        })}
        {guides.map((g, i) => (
          <div key={i} className={`guide guide-${g.axis}`} style={g.axis === 'x' ? { left: `${g.pos}%` } : { top: `${g.pos}%` }} />
        ))}
        {marquee && (
          <div className="marquee" style={{ left: `${marquee.x}%`, top: `${marquee.y}%`, width: `${marquee.w}%`, height: `${marquee.h}%` }} />
        )}
      </div>
      {focus && (
        <button className="exit-level" style={{ left: frame.left + frame.w, top: frame.top }} onPointerDown={(e) => e.stopPropagation()} onClick={exitLevel} title="Step out one level (Esc)">
          ✕
        </button>
      )}
    </div>
  );
}
