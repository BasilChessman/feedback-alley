import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent } from 'react';
import type { Block, Layer, Screen } from '../types';
import { useStore } from '../lib/store';
import { useLiveValues } from '../lib/useLiveValues';
import { collectRefs } from '../lib/variables';
import { Canvas, clampZoom, MAX_ZOOM, MIN_ZOOM } from './Canvas';
import { EditorCtx, EMPTY_SELECTION, selectBlocks, selectLayers, useEditor, type EditorCtxValue, type Selection } from './EditorCtx';
import { containerAt, findLayer } from '../lib/tree';
import { Inspector, FONT_SUGGESTIONS } from './Inspector';
import { Sidebar } from './Sidebar';
import { SettingsDialog } from './SettingsDialog';
import { ValuesCtx } from './fields';
import { useActions } from './actions';

export function Editor({ screenId, onOpenScreen }: { screenId: string | null; onOpenScreen: (id: string) => void }) {
  const { project, mutate, beginGesture } = useStore();
  const screen = project.screens.find((s) => s.id === screenId) ?? project.screens[0];
  const [sel, setSel] = useState<Selection>(EMPTY_SELECTION);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [zoom, setZoom] = useState(1);
  const side = useSideWidth();

  useEffect(() => setSel(EMPTY_SELECTION), [screen.id]);

  // drop selection entries that no longer exist (after undo, delete, etc.)
  useEffect(() => {
    const ids = new Set(screen.blocks.map((b) => b.id));
    const focus = sel.focus && ids.has(sel.focus) ? screen.blocks.find((b) => b.id === sel.focus)! : null;
    const blocks = sel.blocks.filter((id) => ids.has(id));
    // keep the deepest group path that still exists, and only layers that live in it
    let path = sel.path;
    while (focus && path.length && !containerAt(focus, path)) path = path.slice(0, -1);
    const container = focus ? containerAt(focus, path) : null;
    const layers = container ? sel.layers.filter((id) => container.layers.some((l) => l.id === id)) : [];
    if (blocks.length !== sel.blocks.length || (sel.focus && !focus) || path !== sel.path || layers.length !== sel.layers.length) {
      setSel(focus ? { blocks, focus: focus.id, path, layers } : selectBlocks(blocks));
    }
  }, [screen, sel]);

  const refs = useMemo(() => collectRefs(screen), [screen]);
  const { values, status, serverDown } = useLiveValues(refs, project.settings.refreshMs);

  const updateScreen = useCallback(
    (fn: (s: Screen) => void, transient = false) => mutate((p) => fn(p.screens.find((s) => s.id === screen.id)!), transient),
    [mutate, screen.id],
  );
  const updateBlock = useCallback(
    (id: string, fn: (b: Block) => void, transient = false) =>
      updateScreen((s) => { const b = s.blocks.find((b) => b.id === id); if (b) fn(b); }, transient),
    [updateScreen],
  );
  const updateLayer = useCallback(
    (blockId: string, layerId: string, fn: (l: Layer) => void, transient = false) =>
      updateBlock(blockId, (b) => { const l = findLayer(b.layers, layerId); if (l) fn(l); }, transient),
    [updateBlock],
  );

  const ctx: EditorCtxValue = {
    project, screen, values, status, sel, setSel, zoom, setZoom, mutate, beginGesture, updateScreen, updateBlock, updateLayer,
  };

  return (
    <EditorCtx.Provider value={ctx}>
      <ValuesCtx.Provider value={values}>
        <div className="editor" style={{ '--side-w': `${side.width}px` } as CSSProperties}>
          <TopBar serverDown={serverDown} onSettings={() => setSettingsOpen(true)} />
          <Sidebar onOpenScreen={onOpenScreen} />
          <div
            className="side-resizer"
            title="Drag to resize. Double-click to reset."
            onPointerDown={side.startDrag}
            onDoubleClick={side.reset}
          />
          <Canvas />
          <Inspector />
          <Shortcuts />
          {settingsOpen && <SettingsDialog onClose={() => setSettingsOpen(false)} />}
          <datalist id="font-suggestions">
            {FONT_SUGGESTIONS.map((f) => <option key={f} value={f} />)}
          </datalist>
        </div>
      </ValuesCtx.Provider>
    </EditorCtx.Provider>
  );
}

function TopBar({ serverDown, onSettings }: { serverDown: boolean; onSettings: () => void }) {
  const { undo, redo, canUndo, canRedo, saveState } = useStore();
  const { project, screen, status, mutate, sel } = useEditor();
  const { addBlock, addLayer } = useActions();
  const connState = serverDown
    ? { cls: 'error', text: 'Server offline' }
    : Object.values(status).includes('error')
      ? { cls: 'error', text: 'Companion unreachable' }
      : Object.values(status).includes('ok')
        ? { cls: 'ok', text: 'Companion connected' }
        : { cls: 'idle', text: 'No variables in use' };
  return (
    <header className="topbar">
      <span className="brand">Feedback Alley</span>
      <span className="screen-name">{screen.name} <span className="muted">· {screen.aspectW}:{screen.aspectH}</span></span>
      <span className="btn-row tight">
        <button className="icon" title="Undo (⌘Z)" disabled={!canUndo} onClick={undo}>↶</button>
        <button className="icon" title="Redo (⇧⌘Z)" disabled={!canRedo} onClick={redo}>↷</button>
      </span>
      <span className="btn-row tight">
        <button onClick={addBlock}>+ Block</button>
        {(sel.focus || sel.blocks.length === 1) && (
          <>
            <button onClick={() => addLayer('text')}>+ Text</button>
            <button onClick={() => addLayer('shape')}>+ Shape</button>
            <button onClick={() => addLayer('image')}>+ Image</button>
            <button onClick={() => addLayer('bar')}>+ Bar</button>
          </>
        )}
      </span>
      <span className="spacer" />
      <ZoomControl />
      <label className="toggle" title="Snap to screen edges, centers and other items (hold Alt to bypass)">
        <input type="checkbox" checked={project.settings.snap} onChange={(e) => mutate((p) => (p.settings.snap = e.target.checked))} />
        <span>Snap</span>
      </label>
      {project.settings.units === 'px' ? (
        <select
          title="Grid step in pixels (dragging always lands on whole pixels)"
          value={project.settings.gridPx}
          onChange={(e) => mutate((p) => (p.settings.gridPx = Number(e.target.value)))}
        >
          <option value={0}>No grid</option>
          {[5, 10, 20, 40, 60].map((n) => <option key={n} value={n}>Grid {n}px</option>)}
        </select>
      ) : (
        <select
          title="Grid step"
          value={project.settings.grid}
          onChange={(e) => mutate((p) => (p.settings.grid = Number(e.target.value)))}
        >
          <option value={0}>No grid</option>
          <option value={0.5}>Grid 0.5%</option>
          <option value={1}>Grid 1%</option>
          <option value={2.5}>Grid 2.5%</option>
          <option value={5}>Grid 5%</option>
        </select>
      )}
      <span className="segmented units" title="Show and type positions and sizes in % or in pixels">
        {(['%', 'px'] as const).map((u) => (
          <button key={u} className={project.settings.units === u ? 'on' : ''} onClick={() => mutate((p) => (p.settings.units = u))}>{u}</button>
        ))}
      </span>
      <span className={`status ${connState.cls}`} title={connState.text}><span className="dot" /><span className="status-text">{connState.text}</span></span>
      <span className={`save-state ${saveState}`}>{saveState === 'saved' ? 'Saved' : saveState === 'saving' ? 'Saving…' : 'Save failed'}</span>
      <a className="button" href={`#/display/${screen.id}`} target="_blank" rel="noreferrer">Open display ↗</a>
      <a className="button top-icon" href="guide/index.html" target="_blank" rel="noreferrer" title="User guide">?</a>
      <button className="top-icon settings-btn" title="Settings & connections" onClick={onSettings}>⚙</button>
    </header>
  );
}

const ZOOM_STEPS = [0.1, 0.25, 0.33, 0.5, 0.67, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8];
export const zoomStep = (z: number, dir: 1 | -1) =>
  dir > 0 ? ZOOM_STEPS.find((s) => s > z + 0.001) ?? MAX_ZOOM : [...ZOOM_STEPS].reverse().find((s) => s < z - 0.001) ?? MIN_ZOOM;

// 100% = the whole screen fits the canvas area. The slider is logarithmic so
// 10%–100% gets as much travel as 100%–800%.
function ZoomControl() {
  const { zoom, setZoom } = useEditor();
  const [text, setText] = useState('');
  const [editing, setEditing] = useState(false);
  const justFocused = useRef(false);
  const pctText = String(Math.round(zoom * 100));
  const commit = () => {
    const n = parseFloat(text);
    if (!isNaN(n)) setZoom(clampZoom(n / 100));
    setEditing(false);
  };
  return (
    <span className="zoom" title="Zoom: pinch, ⌘/Ctrl + scroll, ⌘+ / ⌘− / ⌘0. Pan: scroll, Space+drag or middle-drag">
      <button className="icon" title="Zoom out (⌘−)" onClick={() => setZoom(zoomStep(zoom, -1))}>−</button>
      <input
        type="range"
        min={Math.log2(MIN_ZOOM)}
        max={Math.log2(MAX_ZOOM)}
        step={0.01}
        value={Math.log2(zoom)}
        onChange={(e) => setZoom(clampZoom(2 ** Number(e.target.value)))}
        onDoubleClick={() => setZoom(1)}
      />
      <button className="icon" title="Zoom in (⌘+)" onClick={() => setZoom(zoomStep(zoom, 1))}>+</button>
      <span className="number-field">
        <input
          className="zoom-input"
          value={editing ? text : pctText}
          onFocus={(e) => {
            setText(pctText);
            setEditing(true);
            e.target.select();
            justFocused.current = true;
          }}
          onMouseUp={(e) => {
            // keep the select-all from focus instead of letting the click place a caret
            if (justFocused.current) e.preventDefault();
            justFocused.current = false;
          }}
          onChange={(e) => setText(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
            if (e.key === 'Escape') {
              setEditing(false);
              (e.target as HTMLInputElement).blur();
            }
          }}
        />
        <span className="suffix">%</span>
      </span>
      <button disabled={Math.abs(zoom - 1) < 0.001} title="Back to 100% — whole screen fits (⌘0)" onClick={() => setZoom(1)}>100%</button>
    </span>
  );
}

function Shortcuts() {
  const { undo, redo } = useStore();
  const { project, sel, setSel, zoom, setZoom } = useEditor();
  const actions = useActions();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      const key = e.key.toLowerCase();
      // zoom keys replace browser page zoom while the editor is open
      if (mod && (key === '=' || key === '+')) { e.preventDefault(); setZoom(zoomStep(zoom, 1)); return; }
      if (mod && (key === '-' || key === '_')) { e.preventDefault(); setZoom(zoomStep(zoom, -1)); return; }
      if (mod && key === '0') { e.preventDefault(); setZoom(1); return; }
      const t = e.target as HTMLElement;
      if (t.closest('input, textarea, select, [contenteditable]')) return;
      if (mod && key === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); return; }
      if (mod && key === 'y') { e.preventDefault(); redo(); return; }
      if (mod && key === 'd') { e.preventDefault(); actions.duplicateSelection(); return; }
      if (mod && key === 'c') { actions.copy(); return; }
      if (mod && key === 'v') { e.preventDefault(); actions.paste(); return; }
      if (key === 'delete' || key === 'backspace') { e.preventDefault(); actions.deleteSelection(); return; }
      if (mod && key === 'g') { e.preventDefault(); e.shiftKey ? actions.ungroup() : actions.group(); return; }
      if (mod && key === 'a' && sel.focus) {
        e.preventDefault();
        const c = containerAt(project.screens.find((s) => s.blocks.some((b) => b.id === sel.focus))!.blocks.find((b) => b.id === sel.focus)!, sel.path);
        if (c) setSel({ ...sel, layers: c.layers.map((l) => l.id) });
        return;
      }
      if (key === 'escape') { actions.exitLevel(); return; }
      if (key === 'enter') {
        // Enter steps in: block -> its layers, group -> its children
        if (!sel.focus && sel.blocks.length === 1) setSel(selectLayers(sel.blocks[0], [], []));
        else if (sel.focus && sel.layers.length === 1) {
          const b = project.screens.flatMap((s) => s.blocks).find((b) => b.id === sel.focus);
          const l = b && containerAt(b, sel.path)?.layers.find((l) => l.id === sel.layers[0]);
          if (l?.type === 'group') actions.enterGroup(l.id);
        }
        return;
      }
      const px = project.settings.units === 'px';
      const step = px ? (e.shiftKey ? 10 : 1) : e.shiftKey ? 1 : 0.1;
      const arrows: Record<string, [number, number]> = { arrowleft: [-step, 0], arrowright: [step, 0], arrowup: [0, -step], arrowdown: [0, step] };
      if (arrows[key]) { e.preventDefault(); actions.nudge(...arrows[key], px); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [project, sel, setSel, undo, redo, actions, zoom, setZoom]);

  return null;
}

// Width of the left pane, adjustable by dragging its edge. Remembered per
// browser (a viewer preference, not part of the project).
const SIDE_KEY = 'feedback-alley.sideWidth';
const SIDE_DEFAULT = 240;
const SIDE_MIN = 180;
const SIDE_MAX = 560;

function useSideWidth() {
  const [width, setWidth] = useState(() => {
    try {
      const saved = Number(localStorage.getItem(SIDE_KEY));
      return saved >= SIDE_MIN && saved <= SIDE_MAX ? saved : SIDE_DEFAULT;
    } catch {
      return SIDE_DEFAULT;
    }
  });
  const save = (w: number) => {
    try {
      localStorage.setItem(SIDE_KEY, String(Math.round(w)));
    } catch {
      // storage unavailable: the width just isn't remembered
    }
  };
  const startDrag = (e: RPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const handle = e.currentTarget;
    const left = (handle.parentElement as HTMLElement).getBoundingClientRect().left;
    handle.setPointerCapture(e.pointerId);
    document.body.classList.add('resizing-cols');
    let w = width;
    const move = (ev: PointerEvent) => {
      // leave the canvas at least 40% of the window
      w = Math.max(SIDE_MIN, Math.min(SIDE_MAX, window.innerWidth * 0.4, ev.clientX - left));
      setWidth(w);
    };
    const up = () => {
      handle.removeEventListener('pointermove', move);
      handle.removeEventListener('pointerup', up);
      document.body.classList.remove('resizing-cols');
      save(w);
    };
    handle.addEventListener('pointermove', move);
    handle.addEventListener('pointerup', up);
  };
  const reset = () => {
    setWidth(SIDE_DEFAULT);
    save(SIDE_DEFAULT);
  };
  return { width, startDrag, reset };
}
