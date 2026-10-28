import { useContext, useLayoutEffect, useRef, useState } from 'react';
import { hasRefs, resolveText } from '../lib/variables';
import { ValuesCtx } from './fields';

// Paired markers the toolbar inserts around the selected text (see renderMarkdown).
type Simple = { open: string; close: string };
const BOLD: Simple = { open: '**', close: '**' };
const ITALIC: Simple = { open: '_', close: '_' };
const UNDERLINE: Simple = { open: '++', close: '++' };
const STRIKE: Simple = { open: '~~', close: '~~' };
type StyleTag = 'color' | 'bg' | 'size';

const ALL_MARKERS = /\*\*|\*|\+\+|~~|(?<!\w)_|_(?!\w)|\{(?:color|bg|size|weight|font):[^{}]*\}|\{\/(?:color|bg|size|weight|font)\}/g;
const SIZES = ['50', '75', '125', '150', '200'];

// Text box with a formatting toolbar. Select words (or variables) and apply
// bold/italic/underline/strike, color, highlight or relative size. Applying
// the same format again removes it.
export function RichTextField({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const ta = useRef<HTMLTextAreaElement>(null);
  const pendingSel = useRef<[number, number] | null>(null);
  const [color, setColor] = useState('#ff4d4d');
  const [highlight, setHighlight] = useState('#ffd400');
  const values = useContext(ValuesCtx);

  // restore the selection after React re-renders the new value
  useLayoutEffect(() => {
    const el = ta.current;
    if (el && pendingSel.current) {
      el.focus();
      el.setSelectionRange(...pendingSel.current);
      pendingSel.current = null;
    }
  }, [value]);

  const commit = (next: string, sel: [number, number]) => {
    pendingSel.current = sel;
    onChange(next);
  };

  const selection = () => {
    const el = ta.current!;
    return { a: el.selectionStart, b: el.selectionEnd, v: el.value };
  };

  const isMarker = (v: string, at: number, m: string) => v.slice(at, at + m.length) === m;

  const toggle = ({ open, close }: Simple) => {
    const { a, b, v } = selection();
    // markers just outside the selection -> remove them
    if (a >= open.length && isMarker(v, a - open.length, open) && isMarker(v, b, close)) {
      return commit(v.slice(0, a - open.length) + v.slice(a, b) + v.slice(b + close.length), [a - open.length, b - open.length]);
    }
    // selection includes the markers -> remove them
    const inner = v.slice(a, b);
    if (inner.length >= open.length + close.length && isMarker(inner, 0, open) && isMarker(inner, inner.length - close.length, close)) {
      const stripped = inner.slice(open.length, inner.length - close.length);
      return commit(v.slice(0, a) + stripped + v.slice(b), [a, a + stripped.length]);
    }
    commit(v.slice(0, a) + open + inner + close + v.slice(b), [a + open.length, b + open.length]);
  };

  // {tag:value}…{/tag}: re-applying with a new value replaces it; the same value removes it.
  const styleTag = (tag: StyleTag, val: string) => {
    const { a, b, v } = selection();
    const before = v.slice(0, a).match(new RegExp(`\\{${tag}:([^{}]*)\\}$`));
    const closeTag = `{/${tag}}`;
    if (before && v.slice(b, b + closeTag.length) === closeTag) {
      const start = a - before[0].length;
      if (before[1] === val) {
        return commit(v.slice(0, start) + v.slice(a, b) + v.slice(b + closeTag.length), [start, start + (b - a)]);
      }
      const open = `{${tag}:${val}}`;
      return commit(v.slice(0, start) + open + v.slice(a), [start + open.length, start + open.length + (b - a)]);
    }
    const open = `{${tag}:${val}}`;
    commit(v.slice(0, a) + open + v.slice(a, b) + closeTag + v.slice(b), [a + open.length, b + open.length]);
  };

  const clear = () => {
    const { a, b, v } = selection();
    if (a === b) {
      const plain = v.replace(ALL_MARKERS, '');
      return commit(plain, [0, plain.length]);
    }
    const plain = v.slice(a, b).replace(ALL_MARKERS, '');
    commit(v.slice(0, a) + plain + v.slice(b), [a, a + plain.length]);
  };

  return (
    <div className="rich-text">
      <div className="format-bar" onMouseDown={(e) => e.target instanceof HTMLButtonElement && e.preventDefault()}>
        <button className="fmt" title="Bold (⌘B)" onClick={() => toggle(BOLD)}><b>B</b></button>
        <button className="fmt" title="Italic (⌘I)" onClick={() => toggle(ITALIC)}><i>I</i></button>
        <button className="fmt" title="Underline (⌘U)" onClick={() => toggle(UNDERLINE)}><u>U</u></button>
        <button className="fmt" title="Strikethrough" onClick={() => toggle(STRIKE)}><s>S</s></button>
        <span className="fmt-sep" />
        <span className="fmt-color" title="Text color for the selection">
          <button className="fmt" onClick={() => styleTag('color', color)}>
            <span className="fmt-a" style={{ borderBottomColor: color }}>A</span>
          </button>
          <input type="color" value={color} onChange={(e) => setColor(e.target.value)} title="Choose text color" />
        </span>
        <span className="fmt-color" title="Highlight the selection">
          <button className="fmt" onClick={() => styleTag('bg', highlight)}>
            <span className="fmt-hl" style={{ background: highlight }}>ab</span>
          </button>
          <input type="color" value={highlight} onChange={(e) => setHighlight(e.target.value)} title="Choose highlight color" />
        </span>
        <select
          className="fmt-size"
          title="Size of the selection, relative to the layer's text"
          value=""
          onChange={(e) => {
            if (e.target.value) styleTag('size', `${e.target.value}%`);
          }}
        >
          <option value="">Size</option>
          {SIZES.map((s) => <option key={s} value={s}>{s}%</option>)}
        </select>
        <span className="fmt-sep" />
        <button className="fmt" title="Remove formatting from the selection (or everything if nothing is selected)" onClick={clear}>
          Clear
        </button>
      </div>
      <textarea
        ref={ta}
        value={value}
        rows={3}
        placeholder={placeholder}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (!(e.metaKey || e.ctrlKey)) return;
          const k = e.key.toLowerCase();
          if (k === 'b') { e.preventDefault(); toggle(BOLD); }
          if (k === 'i') { e.preventDefault(); toggle(ITALIC); }
          if (k === 'u') { e.preventDefault(); toggle(UNDERLINE); }
        }}
      />
      {hasRefs(value) && (
        <span className="live-preview" title="Current value">→ {resolveText(value, values).replace(ALL_MARKERS, '') || <em>(empty)</em>}</span>
      )}
    </div>
  );
}
