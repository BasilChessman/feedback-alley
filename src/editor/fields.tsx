import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createContext, useContext } from 'react';
import type { Values } from '../types';
import { hasRefs, resolveText, toCssColor } from '../lib/variables';
import { api } from '../lib/api';
import { ColorSwatch } from './ColorPicker';

// Live values for inline previews under fields that contain variables.
export const ValuesCtx = createContext<Values>({});

export function Section({ title, children, actions, defaultOpen = true }: { title: string; children: ReactNode; actions?: ReactNode; defaultOpen?: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="section">
      <header onClick={() => setOpen(!open)}>
        <span className={`chev${open ? ' open' : ''}`}>▸</span>
        <h3>{title}</h3>
        <div className="section-actions" onClick={(e) => e.stopPropagation()}>{actions}</div>
      </header>
      {open && <div className="section-body">{children}</div>}
    </section>
  );
}

export function Row({ label, children, hint }: { label: string; children: ReactNode; hint?: ReactNode }) {
  return (
    <div className="row">
      <span className="row-label">{label}</span>
      <span className="row-control">
        {children}
        {hint && <span className="row-hint">{hint}</span>}
      </span>
    </div>
  );
}

// Text input that commits on every keystroke but keeps its own caret stable.
export function TextField({ value, onChange, placeholder, multiline, preview = true }: {
  value: string; onChange: (v: string) => void; placeholder?: string; multiline?: boolean; preview?: boolean;
}) {
  const values = useContext(ValuesCtx);
  const showPreview = preview && hasRefs(value);
  return (
    <>
      {multiline ? (
        <textarea value={value} placeholder={placeholder} rows={2} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input type="text" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      )}
      {showPreview && <span className="live-preview" title="Current value">→ {resolveText(value, values) || <em>(empty)</em>}</span>}
    </>
  );
}

// Number input that lets you type freely (e.g. "-", "1.") and commits valid numbers.
export function NumberField({ value, onChange, min, max, step = 1, suffix }: {
  value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number; suffix?: string;
}) {
  const [text, setText] = useState(fmt(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(fmt(value));
  }, [value]);
  const commit = (s: string) => {
    const n = parseFloat(s);
    if (isNaN(n)) return;
    onChange(clamp(n, min, max));
  };
  return (
    <span className="number-field">
      <input
        type="number"
        value={text}
        step={step}
        min={min}
        max={max}
        onFocus={() => (focused.current = true)}
        onBlur={() => {
          focused.current = false;
          setText(fmt(value));
        }}
        onChange={(e) => {
          setText(e.target.value);
          commit(e.target.value);
        }}
      />
      {suffix && <span className="suffix">{suffix}</span>}
    </span>
  );
}

const fmt = (n: number) => String(Math.round(n * 100) / 100);
const clamp = (n: number, min?: number, max?: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

export function Slider({ value, onChange, min = 0, max = 100, step = 1 }: { value: number; onChange: (v: number) => void; min?: number; max?: number; step?: number }) {
  return (
    <span className="slider">
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} />
      <NumberField value={value} onChange={onChange} min={min} max={max} step={step} />
    </span>
  );
}

// Color: swatch picker plus a text field that also accepts variables,
// rgba(), named colors, or Companion's decimal color integers.
export function ColorField({ value, onChange, allowNone }: { value: string; onChange: (v: string) => void; allowNone?: boolean }) {
  const values = useContext(ValuesCtx);
  const resolved = toCssColor(resolveText(value, values));
  return (
    <span className="color-field">
      <ColorSwatch value={value} display={resolved === 'transparent' ? '' : resolved} onChange={onChange} allowNone={allowNone} />
      <TextField value={value} onChange={onChange} placeholder="#rrggbb or $(var)" />
    </span>
  );
}

export function Select<T extends string | number>({ value, onChange, options }: {
  value: T; onChange: (v: T) => void; options: { value: T; label: string }[];
}) {
  return (
    <select
      value={String(value)}
      onChange={(e) => {
        const o = options.find((o) => String(o.value) === e.target.value);
        if (o) onChange(o.value);
      }}
    >
      {options.map((o) => <option key={String(o.value)} value={String(o.value)}>{o.label}</option>)}
    </select>
  );
}

export function Segmented<T extends string>({ value, onChange, options }: { value: T; onChange: (v: T) => void; options: { value: T; label: ReactNode; title?: string }[] }) {
  return (
    <span className="segmented">
      {options.map((o) => (
        <button key={o.value} type="button" title={o.title} className={o.value === value ? 'on' : ''} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </span>
  );
}

export function Toggle({ value, onChange, label }: { value: boolean; onChange: (v: boolean) => void; label?: string }) {
  return (
    <label className="toggle">
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
      {label && <span>{label}</span>}
    </label>
  );
}

export function ImageField({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  return (
    <span className="image-field">
      <TextField value={value} onChange={onChange} placeholder="URL, /uploads/…, or $(var)" />
      <span className="btn-row">
        <button type="button" disabled={busy} onClick={() => input.current?.click()}>{busy ? 'Uploading…' : 'Upload…'}</button>
        {value && <button type="button" onClick={() => onChange('')}>Clear</button>}
      </span>
      {error && <span className="error">{error}</span>}
      <input
        ref={input}
        type="file"
        accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml"
        hidden
        onChange={async (e) => {
          const file = e.target.files?.[0];
          e.target.value = '';
          if (!file) return;
          setBusy(true);
          setError('');
          try {
            onChange((await api.uploadAsset(file)).url);
          } catch (err) {
            setError(String((err as Error).message));
          } finally {
            setBusy(false);
          }
        }}
      />
    </span>
  );
}
