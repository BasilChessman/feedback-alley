import { createContext, useContext, useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import type { BarLayer, Block, FlashSpec, GroupLayer, ImageLayer, Layer, Screen, Settings, ShapeLayer, TextLayer, TextStyle, Values } from '../types';
import { applyRules } from '../lib/rules';
import { flashAnim, flashSpec, flashTextCls, flashVars } from '../lib/flash';
import { screenPx } from '../lib/pixels';
import { headerRects, supportsHeader } from '../lib/header';
import { readBar, thresholdColor } from '../lib/bar';
import { renderMarkdown, resolveText, toCssColor } from '../lib/variables';


interface RenderCtx {
  scale: number; // output px per reference px
  values: Values;
  settings: Settings;
  editing: boolean;
  onPress?: (block: Block) => void;
}
const Ctx = createContext<RenderCtx | null>(null);
const useRender = () => useContext(Ctx)!;

const color = (raw: string, values: Values, fallback = 'transparent') => toCssColor(resolveText(raw, values), fallback);
const pct = (r: { x: number; y: number; w: number; h: number }): CSSProperties => ({
  position: 'absolute', left: `${r.x}%`, top: `${r.y}%`, width: `${r.w}%`, height: `${r.h}%`,
});

// Fits an aspect-ratio box inside its parent and reports the resulting pixel width.
export function FitStage({ aspect, inset = 0, children }: { aspect: number; inset?: number; children: (width: number, height: number) => ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  const [box, setBox] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = ref.current!;
    const measure = () => setBox({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  const availW = Math.max(0, box.w - inset * 2);
  const availH = Math.max(0, box.h - inset * 2);
  const width = Math.floor(Math.min(availW, availH * aspect));
  const height = Math.floor(width / aspect);
  return (
    <div ref={ref} className="fit-stage">
      {width > 0 && (
        <div style={{ position: 'relative', width, height }}>{children(width, height)}</div>
      )}
    </div>
  );
}

export function ScreenView({ screen, width, values, settings, editing = false, onPress }: {
  screen: Screen; width: number; values: Values; settings: Settings; editing?: boolean; onPress?: (b: Block) => void;
}) {
  const height = (width * screen.aspectH) / screen.aspectW;
  const o = applyRules(screen.rules, values);
  const bgImage = resolveText(screen.backgroundImage, values);
  const t = settings.transitionMs;
  return (
    <Ctx.Provider value={{ scale: width / screenPx(screen).w, values, settings, editing, onPress }}>
      <div
        className="screen"
        style={{
          width, height, background: color(o.fill ?? screen.background, values, '#000'),
          fontFamily: settings.font, transition: t ? `background-color ${t}ms` : undefined,
        }}
      >
        {bgImage && <img className="screen-bg" src={bgImage} alt="" style={{ objectFit: screen.backgroundFit }} />}
        {screen.blocks.map((b) => <BlockView key={b.id} block={b} />)}
      </div>
    </Ctx.Provider>
  );
}

function BlockView({ block }: { block: Block }) {
  const { scale, values, settings, editing, onPress } = useRender();
  const [pressed, setPressed] = useState(false);
  const o = applyRules(block.rules, values);
  // "hidden" means hidden unless a rule shows it; the editor still draws it faintly.
  const ruleHidden = !(o.visible ?? !block.hidden);
  if (ruleHidden && !editing) return null;
  const t = settings.transitionMs;
  const opacity = (o.opacity ?? block.opacity) / 100;
  const clickable = !editing && !!block.press?.location && !!onPress;
  const f = flashSpec(o.flash);
  return (
    <div
      className={`block${flashTextCls(f)}${clickable ? ' clickable' : ''}${pressed ? ' pressed' : ''}`}
      style={{
        ...pct(block),
        background: color(o.fill ?? block.fill, values),
        border: block.borderWidth > 0 ? `${block.borderWidth * scale}px solid ${color(o.borderColor ?? block.borderColor, values)}` : undefined,
        borderRadius: block.radius * scale,
        overflow: block.clip ? 'hidden' : 'visible',
        opacity: ruleHidden ? 0.2 : opacity,
        transition: t ? `background-color ${t}ms, border-color ${t}ms, opacity ${t}ms` : undefined,
        ...flashVars(f),
        ...flashAnim(f, ['all', 'fill', 'border']),
      }}
      onPointerDown={clickable ? () => { setPressed(true); onPress!(block); } : undefined}
      onPointerUp={clickable ? () => setPressed(false) : undefined}
      onPointerLeave={clickable ? () => setPressed(false) : undefined}
    >
      {block.layers.map((l) => <LayerView key={l.id} layer={l} />)}
    </div>
  );
}

const BG_SIZE = { contain: 'contain', cover: 'cover', fill: '100% 100%' } as const;

// Every layer is a positioned wrapper (opacity, flash, background, rounded
// corners) holding its type-specific content, which fills the wrapper.
export function LayerView({ layer }: { layer: Layer }) {
  const { values, editing, scale, settings } = useRender();
  const o = applyRules(layer.rules, values);
  const hidden = !(o.visible ?? !layer.hidden);
  if (hidden && !editing) return null;
  const bgImage = resolveText(layer.bgImage, values).trim();
  const t = settings.transitionMs;
  const f = flashSpec(o.flash);
  const wrapper: CSSProperties = {
    ...pct(layer),
    opacity: hidden ? 0.15 : (o.opacity ?? layer.opacity) / 100,
    backgroundColor: color(o.background ?? layer.bgColor, values),
    backgroundImage: bgImage ? `url("${bgImage.replace(/"/g, '%22')}")` : undefined,
    backgroundSize: bgImage ? BG_SIZE[layer.bgFit] : undefined,
    backgroundPosition: 'center',
    backgroundRepeat: 'no-repeat',
    borderRadius: layer.radius * scale,
    overflow: layer.radius > 0 || (layer.type === 'group' && layer.clip) ? 'hidden' : undefined,
    transition: t ? `background-color ${t}ms` : undefined,
    ...flashVars(f),
    ...flashAnim(f, ['all', 'background']),
  };
  const props = { o, f, style: {}, cls: 'layer-content' };
  const content = (
    <>
      {layer.type === 'text' && <TextLayerView layer={layer} {...props} />}
      {layer.type === 'shape' && <ShapeLayerView layer={layer} {...props} />}
      {layer.type === 'image' && <ImageLayerView layer={layer} {...props} />}
      {layer.type === 'bar' && <BarLayerView layer={layer} {...props} />}
      {layer.type === 'group' && <GroupLayerView layer={layer} {...props} />}
    </>
  );
  // a rule can show a header that's switched off, or hide one that's on
  const header = supportsHeader(layer) && layer.header && (o.headerVisible ?? layer.header.enabled) ? layer.header : null;
  if (!header) {
    return <div className="layer" style={wrapper}>{content}</div>;
  }
  // header strip on one side; the layer's own content fills the rest
  const r = headerRects(header);
  return (
    <div className="layer" style={wrapper}>
      <div className="layer-part" style={{ ...pct(r.content), containerType: 'size' }}>{content}</div>
      <div
        className="layer-part layer-header"
        style={{ ...pct(r.header), backgroundColor: color(o.headerFill ?? header.fill, values), transition: t ? `background-color ${t}ms` : undefined, ...flashAnim(f, ['header']) }}
      >
        <TextView t={header} text={o.headerText} textColor={o.headerTextColor} cls="layer-content" />
      </div>
    </div>
  );
}

type LayerProps<L> = { layer: L; o: ReturnType<typeof applyRules>; f: FlashSpec | null; style: CSSProperties; cls: string };

function TextLayerView({ layer, o, f, style, cls }: LayerProps<TextLayer>) {
  return <TextView t={layer} text={o.text} textColor={o.textColor} style={style} cls={cls + flashTextCls(f)} />;
}

// Text with its settings: a text layer's content, or a layer's header.
// `text` and `textColor` are feedback-rule overrides.
function TextView({ t: layer, text, textColor, style, cls }: { t: TextStyle; text?: string; textColor?: string; style?: CSSProperties; cls: string }) {
  const { values, settings } = useRender();
  const html = renderMarkdown(resolveText(text ?? layer.text, values, { forMarkdown: true }));
  const t = settings.transitionMs;
  const textStyle: CSSProperties = {
    color: color(textColor ?? layer.color, values, '#fff'),
    fontFamily: layer.font || undefined,
    fontWeight: layer.weight,
    fontStyle: layer.italic ? 'italic' : undefined,
    textAlign: layer.align,
    whiteSpace: layer.wrap ? 'normal' : 'nowrap',
    lineHeight: layer.lineHeight,
    ['--para' as string]: `${layer.paraSpacing}em`,
    transition: t ? `color ${t}ms` : undefined,
  };
  return (
    <div className={`${cls} text-layer valign-${layer.valign}`} style={{ ...style, containerType: 'size' }}>
      {layer.sizeMode === 'fit' ? (
        <FitText html={html} maxPct={layer.fontSize} padding={layer.padding} style={textStyle} deps={[layer.font, layer.weight, layer.wrap, layer.italic, layer.lineHeight, layer.paraSpacing, settings.font]} />
      ) : (
        <div
          className="text-inner"
          style={{ ...textStyle, fontSize: `${layer.fontSize}cqh`, padding: `${layer.padding}cqh` }}
          dangerouslySetInnerHTML={{ __html: html }}
        />
      )}
    </div>
  );
}

// Largest font size (up to maxPct of the box height) at which the text fits the box.
function FitText({ html, maxPct, padding, style, deps }: { html: string; maxPct: number; padding: number; style: CSSProperties; deps: unknown[] }) {
  const outer = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const box = outer.current!;
    const el = inner.current!;
    const fit = () => {
      const H = box.clientHeight;
      const pad = (H * padding) / 100;
      const w = box.clientWidth - pad * 2;
      const h = H - pad * 2;
      if (w <= 0 || h <= 0) return;
      // Padding goes on the outer box, so the text is measured against the
      // space inside it. (Measured with its own padding, text that runs into
      // the right-hand padding doesn't count as overflowing.)
      box.style.padding = `${pad}px`;
      const fits = (size: number) => {
        el.style.fontSize = `${size}px`;
        return el.scrollWidth <= el.clientWidth + 0.5 && el.offsetHeight <= h + 0.5;
      };
      let lo = 1;
      let hi = Math.max(1, (H * maxPct) / 100);
      if (fits(hi)) return;
      for (let i = 0; i < 14 && hi - lo > 0.25; i++) {
        const mid = (lo + hi) / 2;
        if (fits(mid)) lo = mid;
        else hi = mid;
      }
      el.style.fontSize = `${lo}px`;
    };
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(box);
    document.fonts?.ready.then(fit);
    return () => ro.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [html, maxPct, padding, ...deps]);
  return (
    <div ref={outer} className="fit-outer">
      <div ref={inner} className="text-inner" style={style} dangerouslySetInnerHTML={{ __html: html }} />
    </div>
  );
}

// Children are laid out in % of the group, exactly like layers in a block.
function GroupLayerView({ layer, o, f, cls }: LayerProps<GroupLayer>) {
  const { values, scale, settings } = useRender();
  const t = settings.transitionMs;
  return (
    <div className={cls + flashTextCls(f)}>
      {layer.layers.map((l) => <LayerView key={l.id} layer={l} />)}
      {layer.borderWidth > 0 && (
        <div
          className="layer-content group-border"
          style={{
            border: `${layer.borderWidth * scale}px solid ${color(o.borderColor ?? layer.borderColor, values)}`,
            borderRadius: layer.radius * scale,
            transition: t ? `border-color ${t}ms` : undefined,
            ...flashAnim(f, ['border']),
          }}
        />
      )}
    </div>
  );
}

function ShapeLayerView({ layer, o, f, style, cls }: LayerProps<ShapeLayer>) {
  const { values, scale, settings } = useRender();
  const t = settings.transitionMs;
  return (
    <div
      className={cls}
      style={{
        ...style,
        background: color(o.fill ?? layer.fill, values),
        borderRadius: layer.radius * scale,
        border: layer.borderWidth > 0 ? `${layer.borderWidth * scale}px solid ${color(o.borderColor ?? layer.borderColor, values)}` : undefined,
        transition: t ? `background-color ${t}ms, border-color ${t}ms` : undefined,
        ...flashAnim(f, ['fill', 'border']),
      }}
    />
  );
}

function ImageLayerView({ layer, style, cls }: LayerProps<ImageLayer>) {
  const { values, scale, editing } = useRender();
  const src = resolveText(layer.src, values).trim();
  if (!src) return editing && !layer.bgColor && !layer.bgImage ? <div className={`${cls} image-empty`} style={style}>Image</div> : null;
  return (
    <img
      className={cls}
      src={src}
      alt=""
      draggable={false}
      style={{ ...style, objectFit: layer.fit, borderRadius: layer.radius * scale }}
    />
  );
}

function BarLayerView({ layer, o, f, style, cls }: LayerProps<BarLayer>) {
  const { values, scale, settings } = useRender();
  const timed = layer.source !== 'value';
  const live = readBar(layer, values);
  const smooth = timed && layer.smooth;
  const time = useSmoothTime(smooth ? live.time : undefined, layer.source === 'remaining' ? -1 : 1, settings.refreshMs);
  const reading = smooth && time !== undefined ? readBar(layer, values, time) : live;
  const frac = isNaN(reading.progress) ? 0 : reading.progress;
  const p = (layer.reverse ? 1 - frac : frac) * 100;
  const fillPos: CSSProperties =
    layer.direction === 'right' ? { left: 0, top: 0, bottom: 0, width: `${p}%` }
    : layer.direction === 'left' ? { right: 0, top: 0, bottom: 0, width: `${p}%` }
    : layer.direction === 'up' ? { left: 0, right: 0, bottom: 0, height: `${p}%` }
    : { left: 0, right: 0, top: 0, height: `${p}%` };
  const t = settings.transitionMs;
  // smooth bars move every frame, so only the color fades
  const anim = t && !smooth ? `${Math.min(t * 2, 400)}ms linear` : undefined;
  const fill = o.fill ?? thresholdColor(layer, reading) ?? layer.fill;
  return (
    <div className={cls} style={{ ...style, background: color(layer.track, values), borderRadius: layer.radius * scale, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute', ...fillPos, background: color(fill, values),
          transition: [anim && `width ${anim}, height ${anim}`, t && `background-color ${t}ms`].filter(Boolean).join(', ') || undefined,
          ...flashAnim(f, ['fill']),
        }}
      />
    </div>
  );
}

// Time variables usually change once a second (or once per poll). Between
// updates, keep the time moving at real speed so the bar glides instead of
// stepping, but never more than one update interval ahead, so a paused
// video only drifts that far before the bar stops.
function useSmoothTime(time: number | undefined, dir: 1 | -1, refreshMs: number) {
  const last = useRef({ time: NaN, at: 0 });
  const [, tick] = useState(0);
  const now = performance.now();
  if (time !== undefined && time !== last.current.time) last.current = { time, at: now };
  const cap = Math.max(1, refreshMs / 1000);
  const ahead = Math.min((now - last.current.at) / 1000, cap);

  useEffect(() => {
    if (time === undefined || isNaN(time)) return;
    let raf = 0;
    const loop = () => {
      tick((n) => n + 1);
      if ((performance.now() - last.current.at) / 1000 < cap) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [time, cap]);

  return time === undefined || isNaN(time) ? time : time + dir * ahead;
}
