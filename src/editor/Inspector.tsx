import type { ReactNode } from 'react';
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { Anchor, BarLayer, Block, GroupLayer, ImageLayer, Layer, LayerHeader, Rect, Screen, ShapeLayer, TextLayer, TextStyle } from '../types';
import { ASPECT_PRESETS, RESOLUTIONS } from '../lib/defaults';
import { containerAt, containerRect, countLayers, groupAt } from '../lib/tree';
import { rectPx, scaleStrokes, screenPx } from '../lib/pixels';
import { selectBlocks, selectLayers, useEditor } from './EditorCtx';
import { useActions, type AlignMode } from './actions';
import { RulesEditor, type RuleProp } from './RulesEditor';
import { RichTextField } from './RichTextField';
import { BarProps } from './BarProps';
import { VariablesPanel } from './VariablesPanel';
import { askText } from './askText';
import { nearestAnchor } from '../lib/fixed';
import { HEADER_MAX, HEADER_MIN, newHeader, supportsHeader } from '../lib/header';
import { ColorField, ImageField, NumberField, Row, Section, Segmented, Select, Slider, TextField, Toggle } from './fields';

export const FONT_SUGGESTIONS = [
  'Inter', 'Helvetica Neue', 'Arial', 'Roboto', 'Open Sans', 'Montserrat', 'Barlow', 'Barlow Condensed',
  'Oswald', 'Bebas Neue', 'DIN Alternate', 'Futura', 'Avenir Next', 'Menlo', 'Courier New', 'Georgia',
];

export function Inspector() {
  const { screen, sel } = useEditor();
  const focus = sel.focus ? screen.blocks.find((b) => b.id === sel.focus) : undefined;
  if (focus) {
    const picked = containerAt(focus, sel.path)?.layers.filter((l) => sel.layers.includes(l.id)) ?? [];
    if (picked.length === 1) return <LayerInspector block={focus} path={sel.path} layer={picked[0]} />;
    if (picked.length > 1) return <MultiLayerInspector block={focus} count={picked.length} />;
    // inside a group with nothing selected: show the group itself
    const group = groupAt(focus, sel.path);
    if (group) return <LayerInspector block={focus} path={sel.path.slice(0, -1)} layer={group} inside />;
    return <BlockInspector block={focus} />;
  }
  if (sel.blocks.length === 1) {
    const b = screen.blocks.find((b) => b.id === sel.blocks[0]);
    if (b) return <BlockInspector block={b} />;
  }
  if (sel.blocks.length > 1) return <MultiInspector />;
  return <ScreenInspector />;
}

// ---------------------------------------------------------------------------

type Kind = 'screen' | 'block' | 'multi' | 'layer';
const KIND_LABEL: Record<Kind, string> = { screen: 'Screen', block: 'Block', multi: 'Selection', layer: 'Layer' };

// Color-coded header that always says what the panel below is editing,
// with a clickable path back up through groups to the block and screen.
function ContextBar({ kind, chip, title, hint, actions, block, path = [], layer }: {
  kind: Kind; chip?: string; title: string; hint: ReactNode; actions?: ReactNode; block?: Block; path?: string[]; layer?: Layer;
}) {
  const { screen, setSel, sel } = useEditor();
  const groups = block ? path.map((_, i) => groupAt(block, path.slice(0, i + 1))!).filter(Boolean) : [];
  return (
    <div className="context-bar">
      <nav className="crumbs">
        <button className={`crumb crumb-screen${kind === 'screen' ? ' current' : ''}`} onClick={() => setSel(selectBlocks([]))}>
          {screen.name}
        </button>
        {block && (
          <>
            <span className="crumb-sep">›</span>
            <button
              className={`crumb crumb-block${kind === 'block' ? ' current' : ''}`}
              onClick={() => setSel(sel.focus === block.id ? selectLayers(block.id, [], []) : selectBlocks([block.id]))}
            >
              {block.name}
            </button>
          </>
        )}
        {groups.map((g, i) => (
          <span key={g.id} className="crumb-wrap">
            <span className="crumb-sep">›</span>
            <button className="crumb crumb-group" onClick={() => setSel(selectLayers(block!.id, path.slice(0, i), [g.id]))}>
              {g.name}
            </button>
          </span>
        ))}
        {layer && (
          <>
            <span className="crumb-sep">›</span>
            <span className={`crumb ${layer.type === 'group' ? 'crumb-group' : 'crumb-layer'} current`}>{layer.name}</span>
          </>
        )}
      </nav>
      <div className="context-title">
        <span className="kind-chip">{chip ?? KIND_LABEL[kind]}</span>
        <strong>{title}</strong>
        <span className="spacer" />
        {actions}
      </div>
      <div className="context-hint">{hint}</div>
    </div>
  );
}

function ItemActions({ what }: { what: string }) {
  const actions = useActions();
  return (
    <>
      <button className="icon" title={`Duplicate ${what} (⌘D)`} onClick={actions.duplicateSelection}>⧉</button>
      <button className="icon danger" title={`Delete ${what} (⌫)`} onClick={actions.deleteSelection}>🗑</button>
    </>
  );
}

// Change the design width, scaling borders and corners so nothing looks different.
function setPxWidth(s: Screen, w: number) {
  if (!(w > 0)) return;
  scaleStrokes(s.blocks, w / screenPx(s).w);
  s.pxWidth = w;
}

function ScreenInspector() {
  const { screen, updateScreen } = useEditor();
  const ratio = `${screen.aspectW}:${screen.aspectH}`;
  const preset = ASPECT_PRESETS.find((p) => p.w === screen.aspectW && p.h === screen.aspectH);
  const displayUrl = `${location.origin}${location.pathname}#/display/${screen.id}`;
  const px = screenPx(screen);
  return (
    <div className="inspector mode-screen">
      <ContextBar kind="screen" title={screen.name} hint="Nothing is selected, so these settings apply to the whole screen. Click a block to edit it." />
      <Section title="Screen">
        <Row label="Name"><TextField value={screen.name} onChange={(v) => updateScreen((s) => (s.name = v))} /></Row>
        <Row label="Aspect ratio">
          <Select
            value={preset ? ratio : 'custom'}
            onChange={(v) => {
              if (v === 'custom') return;
              const [w, h] = v.split(':').map(Number);
              // keep the pixel width, unless this ratio has a common size of the same scale (e.g. 9:16 → 1080×1920)
              const match = RESOLUTIONS[v]?.find(([rw, rh]) => Math.max(rw, rh) === Math.max(px.w, px.h));
              updateScreen((s) => { s.aspectW = w; s.aspectH = h; if (match) setPxWidth(s, match[0]); });
            }}
            options={[...ASPECT_PRESETS.map((p) => ({ value: `${p.w}:${p.h}`, label: p.label })), { value: 'custom', label: 'Custom…' }]}
          />
        </Row>
        <Row label="Custom">
          <span className="pair">
            <NumberField value={screen.aspectW} min={0.1} step={0.1} onChange={(v) => updateScreen((s) => (s.aspectW = v))} />
            <span>:</span>
            <NumberField value={screen.aspectH} min={0.1} step={0.1} onChange={(v) => updateScreen((s) => (s.aspectH = v))} />
          </span>
        </Row>
        <Row label="Pixel size" hint="Used when working in px, and for border widths and corners">
          <span className="pair">
            <NumberField value={px.w} min={16} step={1} onChange={(v) => updateScreen((s) => setPxWidth(s, Math.round(v)))} />
            <span>×</span>
            <NumberField value={px.h} min={16} step={1} onChange={(v) => updateScreen((s) => setPxWidth(s, Math.round((v * s.aspectW) / s.aspectH)))} />
          </span>
        </Row>
        {RESOLUTIONS[ratio] && (
          <span className="btn-row tight">
            {RESOLUTIONS[ratio].map(([w, h]) => (
              <button key={w} className={`small${w === px.w ? ' on' : ''}`} onClick={() => updateScreen((s) => setPxWidth(s, w))}>{w}×{h}</button>
            ))}
          </span>
        )}
        <p className="muted small">
          Layouts are stored relative to the screen, so they scale to fill any output with this ratio. The pixel size
          only sets the units you work in; changing it keeps the layout looking the same.
        </p>
      </Section>
      <Section title="Background">
        <Row label="Color"><ColorField value={screen.background} onChange={(v) => updateScreen((s) => (s.background = v))} /></Row>
        <Row label="Image"><ImageField value={screen.backgroundImage} onChange={(v) => updateScreen((s) => (s.backgroundImage = v))} /></Row>
        {screen.backgroundImage && (
          <Row label="Fit">
            <Segmented value={screen.backgroundFit} onChange={(v) => updateScreen((s) => (s.backgroundFit = v))} options={FIT_OPTIONS} />
          </Row>
        )}
      </Section>
      <Section title="Background feedback" defaultOpen={screen.rules.length > 0}>
        <RulesEditor rules={screen.rules} onChange={(r) => updateScreen((s) => (s.rules = r))} props={['fill']} />
      </Section>
      <Section title="Display output">
        <OutputPortField />
        <p className="muted small">This screen is also always available at:</p>
        <code className="url">{displayUrl}</code>
        <span className="btn-row">
          <button onClick={() => navigator.clipboard?.writeText(displayUrl)}>Copy URL</button>
          <a className="button" href={`#/display/${screen.id}`} target="_blank" rel="noreferrer">Open display ↗</a>
        </span>
      </Section>
    </div>
  );
}

type OutputStatus = Awaited<ReturnType<typeof api.outputs>>;

// Gives the screen its own port so the display is just http://host:<port>/.
function OutputPortField() {
  const { project, screen, updateScreen } = useEditor();
  const [status, setStatus] = useState<OutputStatus | null>(null);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = () =>
      api.outputs().then((s) => !stopped && setStatus(s), () => {}).finally(() => {
        if (!stopped) timer = setTimeout(poll, 1500);
      });
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  const port = screen.outputPort ?? 0;
  const enabled = port > 0;
  const taken = project.screens.find((s) => s.id !== screen.id && s.outputPort === port && port > 0);
  const out = status?.outputs.find((o) => o.port === port);
  const suggest = () => {
    const used = new Set([status?.mainPort, ...project.screens.map((s) => s.outputPort)]);
    let p = 8101;
    while (used.has(p)) p++;
    return p;
  };
  const url = `${location.protocol}//${location.hostname}:${port}/`;

  return (
    <>
      <Row label="Own port">
        <Toggle value={enabled} onChange={(v) => updateScreen((s) => (s.outputPort = v ? suggest() : 0))} label="Serve this screen on its own port" />
      </Row>
      {enabled && (
        <>
          <Row label="Port">
            <NumberField value={port} min={1} max={65535} onChange={(v) => updateScreen((s) => (s.outputPort = Math.round(v)))} />
          </Row>
          {port === status?.mainPort ? (
            <p className="error">That’s the editor’s own port. Pick another.</p>
          ) : taken ? (
            <p className="error">Port {port} is already used by “{taken.name}”.</p>
          ) : out?.state === 'error' ? (
            <p className="error">Can’t open port {port}: {out.error}.</p>
          ) : out?.state === 'ok' && out.screenId === screen.id ? (
            <p className="output-ok">
              ● Live at <a href={url} target="_blank" rel="noreferrer">{url}</a>
              <br /><span className="muted small">Use this machine’s IP address instead of “{location.hostname}” from other computers.</span>
            </p>
          ) : (
            <p className="muted small">Starting…</p>
          )}
        </>
      )}
    </>
  );
}

const FIT_OPTIONS = [
  { value: 'contain' as const, label: 'Contain' },
  { value: 'cover' as const, label: 'Cover' },
  { value: 'fill' as const, label: 'Stretch' },
];

// ---------------------------------------------------------------------------

// Position and size, stored in % of the parent (`unit`). In px mode they're
// shown and typed in pixels of the parent, whose pixel size is `frame`.
function GeometryFields({ rect, onChange, unit, frame }: { rect: Rect; onChange: (r: Partial<Rect>) => void; unit: string; frame: { w: number; h: number } }) {
  const { project, mutate } = useEditor();
  const px = project.settings.units === 'px';
  const size = (k: keyof Rect) => (k === 'x' || k === 'w' ? frame.w : frame.h);
  return (
    <>
      <Row label="Units" hint={px ? `Pixels from the ${unit}’s top-left (${Math.round(frame.w)}×${Math.round(frame.h)}px)` : `Percent of the ${unit}`}>
        <Segmented
          value={project.settings.units}
          onChange={(u) => mutate((p) => (p.settings.units = u))}
          options={[{ value: '%', label: '%' }, { value: 'px', label: 'px' }]}
        />
      </Row>
      <div className="geometry">
        {(['x', 'y', 'w', 'h'] as const).map((k) => (
          <label key={k} title={`${k.toUpperCase()} in ${px ? 'pixels' : '%'} of ${unit}`}>
            <span>{k.toUpperCase()}</span>
            {px ? (
              <NumberField
                value={(rect[k] / 100) * size(k)}
                step={1}
                suffix="px"
                min={k === 'w' || k === 'h' ? 1 : undefined}
                onChange={(v) => onChange({ [k]: (v / size(k)) * 100 })}
              />
            ) : (
              <NumberField value={rect[k]} step={0.1} suffix="%" min={k === 'w' || k === 'h' ? 0.5 : undefined} onChange={(v) => onChange({ [k]: v })} />
            )}
          </label>
        ))}
      </div>
    </>
  );
}

const ANCHOR_NAMES: Record<Anchor, [string, string]> = { 0: ['left', 'top'], 0.5: ['center', 'middle'], 1: ['right', 'bottom'] };
const ANCHORS: Anchor[] = [0, 0.5, 1];

// Relative layers resize with their block or group; fixed ones keep their size,
// held in place by an anchor (see lib/fixed.ts).
function SizingFields({ layer, parentKind, set }: { layer: Layer; parentKind: string; set: Setter }) {
  const fixed = layer.sizing === 'fixed';
  const ax = layer.anchorX ?? 0.5;
  const ay = layer.anchorY ?? 0.5;
  const anchorLabel = (x: Anchor, y: Anchor) =>
    x === 0.5 && y === 0.5 ? 'center' : x === 0.5 ? ANCHOR_NAMES[y][1] : y === 0.5 ? ANCHOR_NAMES[x][0] : `${ANCHOR_NAMES[y][1]} ${ANCHOR_NAMES[x][0]}`;
  return (
    <>
      <Row
        label="Sizing"
        hint={fixed ? `Keeps its size when the ${parentKind} is resized` : `Resizes along with the ${parentKind}`}
      >
        <Segmented
          value={fixed ? 'fixed' : 'relative'}
          onChange={(v) =>
            set((l) => {
              if (v === 'fixed') {
                const a = nearestAnchor(l);
                Object.assign(l, { sizing: 'fixed', anchorX: l.anchorX ?? a.ax, anchorY: l.anchorY ?? a.ay });
              } else {
                l.sizing = 'relative';
              }
            })
          }
          options={[
            { value: 'relative', label: `Relative to ${parentKind}`, title: `Resizes along with the ${parentKind}` },
            { value: 'fixed', label: 'Fixed', title: `Keeps its size when the ${parentKind} is resized` },
          ]}
        />
      </Row>
      {fixed && (
        <Row label="Anchor" hint={`Stays pinned to the ${parentKind}’s ${anchorLabel(ax, ay)} as it resizes`}>
          <span className="anchor-grid">
            {ANCHORS.map((y) =>
              ANCHORS.map((x) => (
                <button
                  key={`${x}-${y}`}
                  className={x === ax && y === ay ? 'on' : ''}
                  title={`Pin to the ${anchorLabel(x, y)}`}
                  onClick={() => set((l) => Object.assign(l, { anchorX: x, anchorY: y }))}
                />
              )),
            )}
          </span>
        </Row>
      )}
    </>
  );
}

function AlignButtons({ title }: { title: string }) {
  const { align, zOrder } = useActions();
  const modes: [AlignMode, string, string][] = [
    ['left', '⇤', 'Align left'], ['hcenter', '↔', 'Center horizontally'], ['right', '⇥', 'Align right'],
    ['top', '⤒', 'Align top'], ['vmiddle', '↕', 'Center vertically'], ['bottom', '⤓', 'Align bottom'],
  ];
  return (
    <>
      <Row label="Align">
        <span className="btn-row tight" title={title}>
          {modes.map(([m, icon, t]) => <button key={m} className="icon" title={`${t} (${title})`} onClick={() => align(m)}>{icon}</button>)}
        </span>
      </Row>
      <Row label="Arrange">
        <span className="btn-row tight">
          <button className="icon" title="Bring to front" onClick={() => zOrder('front')}>⇈</button>
          <button className="icon" title="Bring forward" onClick={() => zOrder('forward')}>↑</button>
          <button className="icon" title="Send backward" onClick={() => zOrder('backward')}>↓</button>
          <button className="icon" title="Send to back" onClick={() => zOrder('back')}>⇊</button>
        </span>
      </Row>
    </>
  );
}

function BlockInspector({ block }: { block: Block }) {
  const { project, screen, sel, setSel, updateBlock } = useEditor();
  const actions = useActions();
  const set = (fn: (b: Block) => void) => updateBlock(block.id, fn);
  const editingLayers = sel.focus === block.id;

  return (
    <div className="inspector mode-block">
      <ContextBar
        kind="block"
        title={block.name}
        block={block}
        actions={<ItemActions what="block" />}
        hint={editingLayers
          ? <>Layer editing is on. Pick a layer on the canvas or in <b>Layers</b> below. Settings here still apply to the <b>whole block</b>.</>
          : <>Settings apply to the <b>whole block</b>. To change one layer, pick it under <b>Layers</b> or double-click the block.</>}
      />
      <Section title="Position & size">
        <Row label="Name"><TextField value={block.name} onChange={(v) => set((b) => (b.name = v))} /></Row>
        <GeometryFields rect={block} unit="screen" frame={screenPx(screen)} onChange={(r) => set((b) => Object.assign(b, r))} />
        <AlignButtons title="screen" />
        <span className="btn-row">
          <button onClick={async () => {
            const name = await askText({ title: 'Save as template', label: 'Template name', value: block.name, okLabel: 'Save' });
            if (name) actions.saveTemplate(name);
          }}>Save as template</button>
        </span>
      </Section>

      <VariablesPanel blocks={[block]} />

      <Section
        title={`Layers (${countLayers(block.layers)})`}
        actions={
          editingLayers
            ? <button className="small" onClick={() => setSel(selectBlocks([block.id]))}>Done</button>
            : <button className="small" onClick={() => setSel(selectLayers(block.id, [], []))}>Edit layers</button>
        }
      >
        <LayerTree block={block} layers={block.layers} parentPath={[]} />
        <AddLayerButtons blockId={block.id} path={[]} />
        <p className="muted small">
          Layers are positioned in % of the block, so they follow it when it’s resized. Double-click a block to drag its layers.
          Shift-click several layers and press <b>Group</b> (⌘G) to combine them.
        </p>
      </Section>

      <Section title="Style">
        <Row label="Fill"><ColorField value={block.fill} onChange={(v) => set((b) => (b.fill = v))} /></Row>
        <Row label="Border"><NumberField value={block.borderWidth} min={0} step={0.5} suffix="px" onChange={(v) => set((b) => (b.borderWidth = v))} /></Row>
        {block.borderWidth > 0 && <Row label="Border color"><ColorField value={block.borderColor} onChange={(v) => set((b) => (b.borderColor = v))} /></Row>}
        <Row label="Corner radius"><NumberField value={block.radius} min={0} suffix="px" onChange={(v) => set((b) => (b.radius = v))} /></Row>
        <Row label="Opacity"><Slider value={block.opacity} onChange={(v) => set((b) => (b.opacity = v))} /></Row>
        <Row label="Clip layers"><Toggle value={block.clip} onChange={(v) => set((b) => (b.clip = v))} /></Row>
        <Row label="Hidden" hint="Hidden unless a rule shows it"><Toggle value={block.hidden} onChange={(v) => set((b) => (b.hidden = v))} /></Row>
        <p className="muted small">Border and radius are in screen pixels and scale with the output.</p>
      </Section>

      <Section title="Feedback rules" defaultOpen={block.rules.length > 0}>
        <RulesEditor rules={block.rules} onChange={(r) => set((b) => (b.rules = r))} props={['fill', 'borderColor', 'opacity', 'visible', 'flash']} />
      </Section>

      <Section title="Button press" defaultOpen={!!block.press}>
        <Row label="On click">
          <Toggle
            value={!!block.press}
            onChange={(v) => set((b) => (b.press = v ? { connection: 0, location: '1/0/0' } : undefined))}
            label="Press a Companion button"
          />
        </Row>
        {block.press && (
          <>
            <Row label="Connection">
              <Select
                value={block.press.connection}
                onChange={(v) => set((b) => (b.press!.connection = v))}
                options={project.connections.map((c, i) => ({ value: i, label: `[${i}] ${c.label}` }))}
              />
            </Row>
            <Row label="Location" hint="page/row/column">
              <TextField value={block.press.location} onChange={(v) => set((b) => (b.press!.location = v))} placeholder="1/0/0" preview={false} />
            </Row>
          </>
        )}
      </Section>
    </div>
  );
}

const LAYER_ICONS: Record<Layer['type'], string> = { text: 'T', shape: '■', image: '🖼', bar: '▭', group: '▣' };

function AddLayerButtons({ blockId, path }: { blockId: string; path: string[] }) {
  const { addLayer } = useActions();
  return (
    <span className="btn-row">
      <button onClick={() => addLayer('text', blockId, path)}>+ Text</button>
      <button onClick={() => addLayer('shape', blockId, path)}>+ Shape</button>
      <button onClick={() => addLayer('image', blockId, path)}>+ Image</button>
      <button onClick={() => addLayer('bar', blockId, path)}>+ Bar</button>
      <button onClick={() => addLayer('group', blockId, path)} title="Empty group: a box that holds its own layers">+ Group</button>
    </span>
  );
}

// Nested layer list. Click selects (Shift/⌘ adds layers at the same level),
// double-click a group to work inside it.
function LayerTree({ block, layers, parentPath, depth = 0 }: { block: Block; layers: Layer[]; parentPath: string[]; depth?: number }) {
  const { sel, setSel, updateLayer } = useEditor();
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  if (!layers.length) return depth === 0 ? <p className="muted small">No layers yet.</p> : null;
  const samePath = sel.focus === block.id && sel.path.join('/') === parentPath.join('/');
  const isEntered = (id: string) => sel.focus === block.id && sel.path.join('/') === [...parentPath, id].join('/');
  return (
    <ul className={`item-list layer-tree${depth ? ' nested' : ''}`}>
      {/* shown top-most first, like most design tools */}
      {[...layers].reverse().map((l) => (
        <li key={l.id} className="tree-node">
          <div
            className={`tree-row${samePath && sel.layers.includes(l.id) ? ' selected' : ''}${isEntered(l.id) ? ' entered' : ''}`}
            style={{ paddingLeft: 6 + depth * 14 }}
            onClick={(e) => {
              const multi = (e.shiftKey || e.metaKey) && samePath;
              const ids = multi ? (sel.layers.includes(l.id) ? sel.layers.filter((x) => x !== l.id) : [...sel.layers, l.id]) : [l.id];
              setSel(selectLayers(block.id, parentPath, ids));
            }}
            onDoubleClick={() => l.type === 'group' && setSel(selectLayers(block.id, [...parentPath, l.id], []))}
          >
            {l.type === 'group' ? (
              <button
                className="icon caret"
                onClick={(e) => {
                  e.stopPropagation();
                  setCollapsed((c) => ({ ...c, [l.id]: !c[l.id] }));
                }}
              >
                {collapsed[l.id] ? '▸' : '▾'}
              </button>
            ) : <span className="caret-space" />}
            <span className={`type-icon${l.type === 'group' ? ' group-icon' : ''}`}>{LAYER_ICONS[l.type]}</span>
            <span className="item-name">{l.name}</span>
            {l.type === 'group' && <span className="muted small">{countLayers(l.layers)}</span>}
            {l.rules.length > 0 && <span className="badge" title="Has feedback rules">ƒ</span>}
            <button
              className={`icon eye${l.hidden ? ' off' : ''}`}
              title={l.hidden ? 'Hidden unless a rule shows it' : 'Visible'}
              onClick={(e) => {
                e.stopPropagation();
                updateLayer(block.id, l.id, (x) => (x.hidden = !x.hidden));
              }}
            >
              {l.hidden ? '◌' : '●'}
            </button>
          </div>
          {l.type === 'group' && !collapsed[l.id] && (
            <LayerTree block={block} layers={l.layers} parentPath={[...parentPath, l.id]} depth={depth + 1} />
          )}
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------------------

function MultiInspector() {
  const { screen, sel } = useEditor();
  const blocks = sel.blocks.map((id) => screen.blocks.find((b) => b.id === id)).filter((b): b is Block => !!b);
  const actions = useActions();
  return (
    <div className="inspector mode-multi">
      <ContextBar
        kind="multi"
        title={`${sel.blocks.length} blocks`}
        actions={<ItemActions what="blocks" />}
        hint="Arrange the selected blocks together, or save them as one template. Select a single block to edit its style."
      />
      <Section title="Arrange">
        <AlignButtons title="selection" />
        {sel.blocks.length > 2 && (
          <Row label="Distribute">
            <span className="btn-row tight">
              <button onClick={() => actions.distribute('x')}>Horizontal</button>
              <button onClick={() => actions.distribute('y')}>Vertical</button>
            </span>
          </Row>
        )}
      </Section>
      <VariablesPanel blocks={blocks} />
      <Section title="Template">
        <p className="muted small">Save these blocks — positions, layers and feedback — to reuse on other screens.</p>
        <button onClick={async () => {
          const name = await askText({ title: 'Save as template', label: 'Template name', value: 'Block group', okLabel: 'Save' });
          if (name) actions.saveTemplate(name);
        }}>Save as template</button>
      </Section>
    </div>
  );
}

// ---------------------------------------------------------------------------

function MultiLayerInspector({ block, count }: { block: Block; count: number }) {
  const { sel } = useEditor();
  const actions = useActions();
  const parent = groupAt(block, sel.path)?.name ?? block.name;
  return (
    <div className="inspector mode-layer">
      <ContextBar
        kind="layer"
        chip="Layers"
        title={`${count} layers`}
        block={block}
        path={sel.path}
        actions={<ItemActions what="layers" />}
        hint={<>Arrange these layers inside “{parent}”, or combine them into a <b>group</b> that moves, resizes and reacts to rules as one.</>}
      />
      <Section title="Group">
        <button className="primary" onClick={actions.group}>▣ Group {count} layers (⌘G)</button>
        <p className="muted small">The group is sized to fit them; nothing moves on screen.</p>
      </Section>
      <Section title="Arrange">
        <AlignButtons title="selection" />
        {count > 2 && (
          <Row label="Distribute">
            <span className="btn-row tight">
              <button onClick={() => actions.distribute('x')}>Horizontal</button>
              <button onClick={() => actions.distribute('y')}>Vertical</button>
            </span>
          </Row>
        )}
      </Section>
    </div>
  );
}

// `path` is the container holding the layer; `inside` means the user has
// stepped into this group and nothing within it is selected.
function LayerInspector({ block, path, layer, inside = false }: { block: Block; path: string[]; layer: Layer; inside?: boolean }) {
  const { screen, setSel, updateLayer } = useEditor();
  const actions = useActions();
  const set = <L extends Layer>(fn: (l: L) => void) => updateLayer(block.id, layer.id, (l) => fn(l as L));
  const ruleProps: Record<Layer['type'], RuleProp[]> = {
    text: ['textColor', 'background', 'text', 'opacity', 'visible', 'flash'],
    shape: ['fill', 'borderColor', 'background', 'opacity', 'visible', 'flash'],
    image: ['background', 'opacity', 'visible', 'flash'],
    bar: ['fill', 'background', 'opacity', 'visible', 'flash'],
    group: ['background', 'borderColor', 'opacity', 'visible', 'flash'],
  };
  const parentGroup = groupAt(block, path);
  const parentName = parentGroup?.name ?? block.name;
  const parentKind = parentGroup ? 'group' : 'block';
  const isGroup = layer.type === 'group';

  return (
    <div className={`inspector mode-layer${isGroup ? ' is-group' : ''}`}>
      <ContextBar
        kind="layer"
        chip={isGroup ? 'Group' : `${layer.type[0].toUpperCase()}${layer.type.slice(1)} layer`}
        title={layer.name}
        block={block}
        path={path}
        layer={layer}
        actions={<ItemActions what={isGroup ? 'group' : 'layer'} />}
        hint={inside
          ? <>You’re working <b>inside this group</b>. Pick one of its layers on the canvas or below. Settings here apply to the whole group.</>
          : isGroup
            ? <>Changes below affect <b>this group and everything in it</b>, inside “{parentName}”. Double-click it to work inside.</>
            : <>Changes below affect <b>only this layer</b> inside {parentKind} “{parentName}”. Position is in % of the {parentKind}.</>}
      />
      <button className="back-to-block" onClick={() => (inside ? actions.exitLevel() : setSel(selectLayers(block.id, path, [])))}>
        ← {inside ? `Step out of “${layer.name}”` : `Back to ${parentKind} “${parentName}”`}
      </button>
      <Section title="Position & size">
        <Row label="Name"><TextField value={layer.name} onChange={(v) => set((l) => (l.name = v))} /></Row>
        <GeometryFields rect={layer} unit={parentKind} frame={rectPx(screen, containerRect(block, path))} onChange={(r) => set((l) => Object.assign(l, r))} />
        <SizingFields layer={layer} parentKind={parentKind} set={set} />
        <span className="btn-row">
          <button onClick={() => set((l) => Object.assign(l, { x: 0, y: 0, w: 100, h: 100 }))}>Fill {parentKind}</button>
        </span>
        {!inside && <AlignButtons title={parentKind} />}
        <Row label="Opacity"><Slider value={layer.opacity} onChange={(v) => set((l) => (l.opacity = v))} /></Row>
        <Row label="Hidden" hint="Hidden unless a rule shows it"><Toggle value={layer.hidden} onChange={(v) => set((l) => (l.hidden = v))} /></Row>
      </Section>

      {supportsHeader(layer) && <HeaderProps layer={layer} set={set} />}
      {layer.type === 'group' && <GroupProps block={block} path={path} layer={layer} set={set} inside={inside} />}
      {layer.type === 'text' && <TextProps layer={layer} set={set} />}
      {layer.type === 'shape' && <ShapeProps layer={layer} set={set} />}
      {layer.type === 'image' && <ImageProps layer={layer} set={set} />}
      {layer.type === 'bar' && <BarProps layer={layer} set={(fn) => set<BarLayer>(fn)} />}

      <Section title="Background & corners" defaultOpen={!!(layer.bgColor || layer.bgImage || layer.radius)}>
        <Row label="Color" hint="Leave empty for none">
          <ColorField value={layer.bgColor} allowNone onChange={(v) => set((l) => (l.bgColor = v))} />
        </Row>
        <Row label="Image"><ImageField value={layer.bgImage} onChange={(v) => set((l) => (l.bgImage = v))} /></Row>
        {layer.bgImage && (
          <Row label="Fit"><Segmented value={layer.bgFit} onChange={(v) => set((l) => (l.bgFit = v))} options={FIT_OPTIONS} /></Row>
        )}
        <Row label="Corner radius" hint="Rounds the background and clips the content">
          <NumberField value={layer.radius} min={0} suffix="px" onChange={(v) => set((l) => (l.radius = v))} />
        </Row>
      </Section>

      <Section title="Feedback rules" defaultOpen>
        <RulesEditor rules={layer.rules} onChange={(r) => set((l) => (l.rules = r))} props={supportsHeader(layer) && layer.header ? [...ruleProps[layer.type], ...HEADER_RULE_PROPS] : ruleProps[layer.type]} />
      </Section>
    </div>
  );
}

type Setter = <L extends Layer>(fn: (l: L) => void) => void;

function GroupProps({ block, path, layer, set, inside }: { block: Block; path: string[]; layer: GroupLayer; set: Setter; inside: boolean }) {
  const { setSel } = useEditor();
  const { ungroup } = useActions();
  const s = (fn: (l: GroupLayer) => void) => set<GroupLayer>(fn);
  const childPath = [...path, layer.id];
  return (
    <>
      <Section title={`Layers in group (${countLayers(layer.layers)})`}>
        <LayerTree block={block} layers={layer.layers} parentPath={childPath} />
        <AddLayerButtons blockId={block.id} path={childPath} />
        <span className="btn-row">
          {!inside && <button onClick={() => setSel(selectLayers(block.id, childPath, []))}>Edit inside group ↵</button>}
          <button
            onClick={() => ungroup({ path, ids: [layer.id] })}
            title="Replace the group with its layers (⇧⌘G)"
          >
            Ungroup
          </button>
        </span>
        <p className="muted small">Layers in a group are positioned in % of the group and follow it when it’s moved or resized.</p>
      </Section>
      <Section title="Group style">
        <Row label="Clip contents"><Toggle value={layer.clip} onChange={(v) => s((l) => (l.clip = v))} /></Row>
        <Row label="Border"><NumberField value={layer.borderWidth} min={0} step={0.5} suffix="px" onChange={(v) => s((l) => (l.borderWidth = v))} /></Row>
        {layer.borderWidth > 0 && <Row label="Border color"><ColorField value={layer.borderColor} onChange={(v) => s((l) => (l.borderColor = v))} /></Row>}
      </Section>
    </>
  );
}

function TextProps({ layer, set }: { layer: TextLayer; set: Setter }) {
  return (
    <Section title="Text">
      <TextStyleFields t={layer} set={(fn) => set<TextLayer>(fn)} />
    </Section>
  );
}

// Text and how it's set, for a text layer or a layer's header.
function TextStyleFields({ t, set: s, sizeOf = 'layer' }: { t: TextStyle; set: (fn: (x: TextStyle) => void) => void; sizeOf?: string }) {
  return (
    <>
      <RichTextField value={t.text} onChange={(v) => s((x) => (x.text = v))} placeholder="Text with $(connection:variable)" />
      <p className="muted small">
        Select words or variables, then use the toolbar. Variables: <code>$(internal:time_hms)</code>, other connections <code>[1]$(…)</code>.
        Enter = new line; a blank line starts a new paragraph.
      </p>
      <Row label="Size">
        <Segmented value={t.sizeMode} onChange={(v) => s((x) => (x.sizeMode = v))} options={[{ value: 'fit', label: 'Auto-fit' }, { value: 'fixed', label: 'Fixed' }]} />
      </Row>
      <Row label={t.sizeMode === 'fit' ? 'Max size' : 'Font size'} hint={`% of ${sizeOf} height`}>
        <Slider value={t.fontSize} min={5} max={100} onChange={(v) => s((x) => (x.fontSize = v))} />
      </Row>
      <Row label="Font">
        <input list="font-suggestions" value={t.font} placeholder="Project default" onChange={(e) => s((x) => (x.font = e.target.value))} />
      </Row>
      <Row label="Weight">
        <Select value={t.weight} onChange={(v) => s((x) => (x.weight = v))} options={[300, 400, 500, 600, 700, 800, 900].map((w) => ({ value: w, label: String(w) }))} />
      </Row>
      <Row label="Italic"><Toggle value={t.italic} onChange={(v) => s((x) => (x.italic = v))} /></Row>
      <Row label="Color"><ColorField value={t.color} onChange={(v) => s((x) => (x.color = v))} /></Row>
      <Row label="Align">
        <Segmented value={t.align} onChange={(v) => s((x) => (x.align = v))} options={[{ value: 'left', label: 'Left' }, { value: 'center', label: 'Center' }, { value: 'right', label: 'Right' }]} />
      </Row>
      <Row label="Vertical">
        <Segmented value={t.valign} onChange={(v) => s((x) => (x.valign = v))} options={[{ value: 'top', label: 'Top' }, { value: 'middle', label: 'Middle' }, { value: 'bottom', label: 'Bottom' }]} />
      </Row>
      <Row label="Line spacing" hint="× text size">
        <Slider value={t.lineHeight} min={0.7} max={3} step={0.05} onChange={(v) => s((x) => (x.lineHeight = v))} />
      </Row>
      <Row label="Paragraph spacing" hint="Extra space between paragraphs, × text size">
        <Slider value={t.paraSpacing} min={0} max={3} step={0.05} onChange={(v) => s((x) => (x.paraSpacing = v))} />
      </Row>
      <Row label="Wrap lines"><Toggle value={t.wrap} onChange={(v) => s((x) => (x.wrap = v))} /></Row>
      <Row label="Padding" hint={`% of ${sizeOf} height`}><NumberField value={t.padding} min={0} max={45} onChange={(v) => s((x) => (x.padding = v))} /></Row>
    </>
  );
}

const HEADER_RULE_PROPS: RuleProp[] = ['headerVisible', 'headerFill', 'headerTextColor', 'headerText'];

const HEADER_SIDES: { value: LayerHeader['side']; label: string }[] = [
  { value: 'top', label: 'Top' }, { value: 'bottom', label: 'Bottom' },
  { value: 'left', label: 'Left' }, { value: 'right', label: 'Right' },
];

// An optional strip along one side of the layer with its own fill and text.
function HeaderProps({ layer, set }: { layer: Layer; set: Setter }) {
  const h = layer.header;
  const on = !!h?.enabled;
  const sh = (fn: (x: LayerHeader) => void) => set((l) => fn(l.header!));
  return (
    <Section title="Header" defaultOpen={on}>
      <Row label="Show header" hint="A strip along one side with its own fill and text">
        <Toggle
          value={on}
          onChange={(v) => set((l) => {
            if (!l.header) l.header = newHeader();
            l.header.enabled = v;
          })}
        />
      </Row>
      {on && h && (
        <>
          <Row label="Side">
            <Select value={h.side} onChange={(v) => sh((x) => (x.side = v))} options={[...HEADER_SIDES]} />
          </Row>
          <Row label="Size" hint={`% of the layer’s ${h.side === 'top' || h.side === 'bottom' ? 'height' : 'width'}. You can also drag the divider on the canvas.`}>
            <Slider value={Math.round(h.size)} min={HEADER_MIN} max={HEADER_MAX} onChange={(v) => sh((x) => (x.size = v))} />
          </Row>
          <Row label="Fill"><ColorField value={h.fill} allowNone onChange={(v) => sh((x) => (x.fill = v))} /></Row>
          <div className="subhead">Header text</div>
          <TextStyleFields t={h} set={(fn) => sh(fn)} sizeOf="header" />
        </>
      )}
      {h && (
        <p className="muted small">
          Use <b>Feedback rules</b> below to change the header’s fill, text or text color, or to show or hide it, when values change.
        </p>
      )}
    </Section>
  );
}

function ShapeProps({ layer, set }: { layer: ShapeLayer; set: Setter }) {
  const s = (fn: (l: ShapeLayer) => void) => set<ShapeLayer>(fn);
  return (
    <Section title="Shape">
      <Row label="Fill"><ColorField value={layer.fill} onChange={(v) => s((l) => (l.fill = v))} /></Row>
      <Row label="Border"><NumberField value={layer.borderWidth} min={0} step={0.5} suffix="px" onChange={(v) => s((l) => (l.borderWidth = v))} /></Row>
      {layer.borderWidth > 0 && <Row label="Border color"><ColorField value={layer.borderColor} onChange={(v) => s((l) => (l.borderColor = v))} /></Row>}
    </Section>
  );
}

function ImageProps({ layer, set }: { layer: ImageLayer; set: Setter }) {
  const s = (fn: (l: ImageLayer) => void) => set<ImageLayer>(fn);
  return (
    <Section title="Image">
      <Row label="Source"><ImageField value={layer.src} onChange={(v) => s((l) => (l.src = v))} /></Row>
      <Row label="Fit"><Segmented value={layer.fit} onChange={(v) => s((l) => (l.fit = v))} options={FIT_OPTIONS} /></Row>
    </Section>
  );
}

