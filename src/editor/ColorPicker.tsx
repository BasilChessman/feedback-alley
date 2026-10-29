import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties, type PointerEvent as RPointerEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useOptionalStore } from '../lib/store';

// A color popover in the spirit of the macOS color panel: a palette grid, a
// spectrum, RGB/HSB sliders, opacity, hex entry, an eyedropper and recent
// colors. Values come out as #rrggbb, or #rrggbbaa when not fully opaque.

interface RGBA { r: number; g: number; b: number; a: number } // 0-255, a 0-1
interface HSV { h: number; s: number; v: number } // h 0-360, s/v 0-1

const clamp = (n: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, n));
const hex2 = (n: number) => Math.round(clamp(n, 0, 255)).toString(16).padStart(2, '0');

export function toHex({ r, g, b, a }: RGBA) {
  return `#${hex2(r)}${hex2(g)}${hex2(b)}${a < 1 ? hex2(a * 255) : ''}`;
}

// Any CSS color the browser understands -> RGBA, or null.
let ctx2d: CanvasRenderingContext2D | null = null;
export function parseColor(css: string): RGBA | null {
  const s = css.trim();
  if (!s || s === 'transparent') return null;
  const m = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i.exec(s);
  if (m) {
    let h = m[1];
    if (h.length <= 4) h = [...h].map((c) => c + c).join('');
    return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16), a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1 };
  }
  ctx2d ??= document.createElement('canvas').getContext('2d');
  if (!ctx2d) return null;
  ctx2d.fillStyle = '#010203';
  ctx2d.fillStyle = s;
  const out = String(ctx2d.fillStyle);
  if (out === '#010203' && s.toLowerCase() !== '#010203') return null; // not a color
  if (out.startsWith('#')) return parseColor(out);
  const n = /rgba?\(([^)]+)\)/.exec(out)?.[1].split(',').map((x) => parseFloat(x));
  return n ? { r: n[0], g: n[1], b: n[2], a: n[3] ?? 1 } : null;
}

function rgbToHsv({ r, g, b }: RGBA): HSV {
  const R = r / 255, G = g / 255, B = b / 255;
  const max = Math.max(R, G, B), min = Math.min(R, G, B), d = max - min;
  let h = 0;
  if (d) h = max === R ? ((G - B) / d) % 6 : max === G ? (B - R) / d + 2 : (R - G) / d + 4;
  return { h: (h * 60 + 360) % 360, s: max ? d / max : 0, v: max };
}

function hsvToRgb({ h, s, v }: HSV): Omit<RGBA, 'a'> {
  const f = (n: number) => {
    const k = (n + h / 60) % 6;
    return (v - v * s * Math.max(0, Math.min(k, 4 - k, 1))) * 255;
  };
  return { r: f(5), g: f(3), b: f(1) };
}

// Palette grid: a row of grays, then hues from light to dark.
const GRID: string[][] = (() => {
  const rows: string[][] = [];
  rows.push(Array.from({ length: 12 }, (_, i) => toHex({ r: 255 - i * 23.2, g: 255 - i * 23.2, b: 255 - i * 23.2, a: 1 })));
  const hues = [0, 20, 35, 50, 75, 120, 160, 185, 205, 230, 265, 300];
  const shades: [number, number][] = [[0.25, 1], [0.45, 1], [0.7, 1], [0.9, 1], [1, 0.95], [1, 0.75], [1, 0.55], [1, 0.38]];
  for (const [s, v] of shades) rows.push(hues.map((h) => toHex({ ...hsvToRgb({ h, s, v }), a: 1 })));
  return rows;
})();

const RECENT_KEY = 'feedback-alley.recentColors';
function loadRecent(): string[] {
  try {
    const r = JSON.parse(localStorage.getItem(RECENT_KEY) || '[]');
    return Array.isArray(r) ? r.filter((x) => typeof x === 'string').slice(0, 14) : [];
  } catch {
    return [];
  }
}
function saveRecent(color: string) {
  try {
    const next = [color, ...loadRecent().filter((c) => c.toLowerCase() !== color.toLowerCase())].slice(0, 14);
    localStorage.setItem(RECENT_KEY, JSON.stringify(next));
  } catch {
    // storage unavailable: recents just aren't remembered
  }
}

type Tab = 'grid' | 'spectrum' | 'sliders';
let lastTab: Tab = 'grid';

type EyeDropperCtor = new () => { open: () => Promise<{ sRGBHex: string }> };

export function ColorPopover({ value, onChange: onChangeRaw, onClose, anchor, allowNone }: {
  value: string; // a CSS color; '' or unparseable starts from white
  onChange: (hex: string) => void;
  onClose: () => void;
  anchor: HTMLElement;
  allowNone?: boolean;
}) {
  const store = useOptionalStore();
  const parsed = parseColor(value);
  const [rgba, setRgba] = useState<RGBA>(parsed ?? { r: 255, g: 255, b: 255, a: 1 });
  // hue/saturation are kept separately so they survive at black/white/gray
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(parsed ?? { r: 255, g: 255, b: 255, a: 1 }));
  const [tab, setTab] = useState<Tab>(lastTab);
  const [hexText, setHexText] = useState(toHex(rgba));
  const [recent] = useState(loadRecent);
  const pop = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState({ left: -9999, top: 0 });
  const latest = useRef(toHex(rgba));
  const changed = useRef(false);
  // everything changed while the picker is open is one undo step
  const onChange = (hex: string) => {
    store?.holdHistory();
    changed.current = true;
    onChangeRaw(hex);
  };
  const EyeDropper = (window as unknown as { EyeDropper?: EyeDropperCtor }).EyeDropper;

  // follow outside edits (e.g. undo) while open
  useEffect(() => {
    const p = parseColor(value);
    if (p && toHex(p) !== latest.current) {
      setRgba(p);
      setHsv(rgbToHsv(p));
      setHexText(toHex(p));
      latest.current = toHex(p);
    }
  }, [value]);

  useLayoutEffect(() => {
    const a = anchor.getBoundingClientRect();
    const el = pop.current!;
    const w = el.offsetWidth, h = el.offsetHeight;
    let left = a.left;
    let top = a.bottom + 6;
    if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
    if (top + h > window.innerHeight - 8) top = Math.max(8, a.top - h - 6);
    setPos({ left: Math.max(8, left), top });
  }, [anchor, tab]);

  // close on outside click or Esc
  useEffect(() => {
    const down = (e: PointerEvent) => {
      if (!pop.current?.contains(e.target as Node) && !anchor.contains(e.target as Node)) onClose();
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); onClose(); }
    };
    window.addEventListener('pointerdown', down, true);
    window.addEventListener('keydown', key, true);
    return () => {
      window.removeEventListener('pointerdown', down, true);
      window.removeEventListener('keydown', key, true);
      store?.releaseHistory();
      if (changed.current && latest.current) saveRecent(latest.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const emit = (c: RGBA, h?: HSV) => {
    setRgba(c);
    if (h) setHsv(h);
    else setHsv((prev) => {
      const n = rgbToHsv(c);
      // keep hue (and saturation) where they're undefined
      return { h: n.s === 0 || n.v === 0 ? prev.h : n.h, s: n.v === 0 ? prev.s : n.s, v: n.v };
    });
    const hex = toHex(c);
    setHexText(hex);
    latest.current = hex;
    onChange(hex);
  };
  const setFromHsv = (h: HSV) => emit({ ...hsvToRgb(h), a: rgba.a }, h);
  const pickTab = (t: Tab) => { lastTab = t; setTab(t); };

  return createPortal(
    <div ref={pop} className="color-pop" style={pos} onPointerDown={(e) => e.stopPropagation()}>
      <div className="color-tabs">
        {(['grid', 'spectrum', 'sliders'] as Tab[]).map((t) => (
          <button key={t} className={tab === t ? 'on' : ''} onClick={() => pickTab(t)}>{t[0].toUpperCase() + t.slice(1)}</button>
        ))}
      </div>

      {tab === 'grid' && (
        <div className="color-grid">
          {GRID.flat().map((c, i) => (
            <button
              key={i}
              className={toHex({ ...rgba, a: 1 }) === c ? 'on' : ''}
              style={{ background: c }}
              title={c}
              onClick={() => emit({ ...parseColor(c)!, a: rgba.a })}
            />
          ))}
        </div>
      )}

      {tab === 'spectrum' && (
        <>
          <Pad2D
            className="sv-pad"
            style={{ background: `linear-gradient(to top, #000, transparent), linear-gradient(to right, #fff, hsl(${hsv.h} 100% 50%))` }}
            x={hsv.s}
            y={1 - hsv.v}
            onMove={(x, y) => setFromHsv({ h: hsv.h, s: x, v: 1 - y })}
          />
          <Bar
            className="hue-bar"
            style={{ background: 'linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)' }}
            value={hsv.h / 360}
            onMove={(x) => setFromHsv({ ...hsv, h: x * 360 })}
          />
        </>
      )}

      {tab === 'sliders' && (
        <div className="color-sliders">
          <div className="muted small">RGB</div>
          {(['r', 'g', 'b'] as const).map((k) => (
            <SliderRow
              key={k}
              label={k.toUpperCase()}
              value={Math.round(rgba[k])}
              max={255}
              gradient={`linear-gradient(to right, ${toHex({ ...rgba, [k]: 0, a: 1 })}, ${toHex({ ...rgba, [k]: 255, a: 1 })})`}
              onChange={(v) => emit({ ...rgba, [k]: v })}
            />
          ))}
          <div className="muted small">HSB</div>
          <SliderRow label="H" value={Math.round(hsv.h)} max={360} gradient="linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00)" onChange={(v) => setFromHsv({ ...hsv, h: v })} />
          <SliderRow
            label="S" value={Math.round(hsv.s * 100)} max={100}
            gradient={`linear-gradient(to right, ${toHex({ ...hsvToRgb({ ...hsv, s: 0 }), a: 1 })}, ${toHex({ ...hsvToRgb({ ...hsv, s: 1 }), a: 1 })})`}
            onChange={(v) => setFromHsv({ ...hsv, s: v / 100 })}
          />
          <SliderRow
            label="B" value={Math.round(hsv.v * 100)} max={100}
            gradient={`linear-gradient(to right, #000, ${toHex({ ...hsvToRgb({ ...hsv, v: 1 }), a: 1 })})`}
            onChange={(v) => setFromHsv({ ...hsv, v: v / 100 })}
          />
        </div>
      )}

      <div className="color-common">
        <SliderRow
          label="Opacity"
          value={Math.round(rgba.a * 100)}
          max={100}
          suffix="%"
          gradient={`linear-gradient(to right, transparent, ${toHex({ ...rgba, a: 1 })}), repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 10px 10px`}
          onChange={(v) => emit({ ...rgba, a: v / 100 })}
        />
        <div className="color-hex-row">
          <span className="color-preview" style={{ background: `linear-gradient(${toHex(rgba)}, ${toHex(rgba)}), repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 10px 10px` }} />
          <input
            className="color-hex"
            value={hexText}
            spellCheck={false}
            onChange={(e) => {
              setHexText(e.target.value);
              const v = e.target.value.trim();
              const p = parseColor(v.startsWith('#') || !/^[0-9a-f]+$/i.test(v) ? v : `#${v}`);
              if (p) {
                setRgba(p);
                setHsv(rgbToHsv(p));
                latest.current = toHex(p);
                onChange(toHex(p));
              }
            }}
            onBlur={() => setHexText(toHex(rgba))}
          />
          {EyeDropper && (
            <button
              className="icon eyedropper"
              title="Pick a color from anywhere on screen"
              onClick={async () => {
                try {
                  const r = await new EyeDropper().open();
                  const p = parseColor(r.sRGBHex);
                  if (p) emit({ ...p, a: rgba.a });
                } catch {
                  // cancelled
                }
              }}
            >
              <EyedropperIcon />
            </button>
          )}
          {allowNone && (
            <button className="small" title="No color" onClick={() => { latest.current = ''; onChange(''); onClose(); }}>None</button>
          )}
        </div>
        {recent.length > 0 && (
          <div className="color-recent">
            <span className="muted small">Recent</span>
            {recent.map((c) => (
              <button key={c} title={c} style={{ background: `linear-gradient(${c}, ${c}), repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 8px 8px` }} onClick={() => emit(parseColor(c)!)} />
            ))}
          </div>
        )}
      </div>
    </div>,
    document.body,
  );
}

function EyedropperIcon() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="m2 22 1-1h3l9-9" /><path d="M3 21v-3l9-9" /><path d="m15 6 3.4-3.4a2.1 2.1 0 1 1 3 3L18 9l.4.4a2.1 2.1 0 1 1-3 3l-3.8-3.8a2.1 2.1 0 1 1 3-3l.4.4Z" />
    </svg>
  );
}

// Drag anywhere in the element; x/y are 0-1.
function useDrag(onMove: (x: number, y: number) => void) {
  return (e: RPointerEvent<HTMLDivElement>) => {
    const el = e.currentTarget;
    el.setPointerCapture(e.pointerId);
    const at = (ev: { clientX: number; clientY: number }) => {
      const r = el.getBoundingClientRect();
      onMove(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
    };
    at(e);
    const move = (ev: PointerEvent) => at(ev);
    const up = () => {
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', up);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', up);
  };
}

function Pad2D({ x, y, onMove, className, style }: { x: number; y: number; onMove: (x: number, y: number) => void; className: string; style: CSSProperties }) {
  const down = useDrag(onMove);
  return (
    <div className={className} style={style} onPointerDown={down}>
      <span className="color-knob" style={{ left: `${x * 100}%`, top: `${y * 100}%` }} />
    </div>
  );
}

function Bar({ value, onMove, className, style }: { value: number; onMove: (x: number) => void; className: string; style: CSSProperties }) {
  const down = useDrag((x) => onMove(x));
  return (
    <div className={className} style={style} onPointerDown={down}>
      <span className="color-knob" style={{ left: `${value * 100}%`, top: '50%' }} />
    </div>
  );
}

function SliderRow({ label, value, max, gradient, onChange, suffix }: { label: ReactNode; value: number; max: number; gradient: string; onChange: (v: number) => void; suffix?: string }) {
  return (
    <div className="color-slider-row">
      <span className="color-slider-label">{label}</span>
      <Bar className="color-track" style={{ background: gradient }} value={value / max} onMove={(x) => onChange(Math.round(x * max))} />
      <span className="color-num">
        <input
          type="number"
          min={0}
          max={max}
          value={value}
          onChange={(e) => {
            const n = parseFloat(e.target.value);
            if (!isNaN(n)) onChange(clamp(n, 0, max));
          }}
        />
        {suffix}
      </span>
    </div>
  );
}

// A swatch button that opens the color popover.
export function ColorSwatch({ value, display, onChange, allowNone, className = 'swatch', title, children }: {
  value: string; // the raw value, passed to the picker
  display?: string; // resolved CSS color for the swatch (defaults to value)
  onChange: (hex: string) => void;
  allowNone?: boolean;
  className?: string;
  title?: string;
  children?: ReactNode;
}) {
  const btn = useRef<HTMLButtonElement>(null);
  const [open, setOpen] = useState(false);
  const shown = display ?? value;
  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${className}${open ? ' open' : ''}`}
        title={title ?? 'Choose a color'}
        style={children ? undefined : { background: `linear-gradient(${shown || 'transparent'}, ${shown || 'transparent'}), repeating-conic-gradient(#888 0 25%, #ccc 0 50%) 0 0 / 8px 8px` }}
        onClick={() => setOpen((o) => !o)}
      >
        {children}
      </button>
      {open && btn.current && (
        <ColorPopover value={shown} onChange={onChange} onClose={() => setOpen(false)} anchor={btn.current} allowNone={allowNone} />
      )}
    </>
  );
}
