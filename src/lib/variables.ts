import type { Values } from '../types';

// Same reference syntax as Companion / Companion Dashboard:
//   $(internal:time_hms)      default connection
//   [1]$(atem:pgm_input)      connection #1 (zero-based; [0] is the default)
//   \$(custom:title)          escaped: value is shown literally, no markdown
const VAR_RE = /(\\)?(?:\[(\d+)\])?\$\(([^:)\s]+:[^)\s]+)\)/g;

export interface VarMatch {
  key: string; // canonical lookup key sent to the server
  full: string;
  escaped: boolean;
}

export function refKey(conn: number, variable: string) {
  return conn > 0 ? `[${conn}]$(${variable})` : `$(${variable})`;
}

export function parseRefs(source: string): VarMatch[] {
  const out: VarMatch[] = [];
  if (!source) return out;
  for (const m of source.matchAll(VAR_RE)) {
    out.push({ key: refKey(m[2] ? parseInt(m[2], 10) : 0, m[3]), full: m[0], escaped: !!m[1] });
  }
  return out;
}

export function hasRefs(source: string | undefined) {
  return !!source && parseRefs(source).length > 0;
}

// Every variable referenced anywhere inside a screen (or any JSON-able value).
export function collectRefs(obj: unknown): string[] {
  const set = new Set<string>();
  JSON.stringify(obj, (_k, v) => {
    if (typeof v === 'string' && v.includes('$(')) for (const r of parseRefs(v)) set.add(r.key);
    return v;
  });
  return [...set].sort();
}

// Characters with formatting meaning; escaped variables (\$(…)) have them backslash-escaped.
const MD_CHARS = /([*\\_~+{}])/g;

// Substitute live values into a string. Unknown/unavailable variables become ''.
export function resolveText(source: string, values: Values, opts?: { forMarkdown?: boolean }): string {
  if (!source || !source.includes('$(')) return source || '';
  return source.replace(VAR_RE, (_full, esc: string | undefined, conn: string | undefined, variable: string) => {
    const v = values[refKey(conn ? parseInt(conn, 10) : 0, variable)] ?? '';
    return esc && opts?.forMarkdown ? v.replace(MD_CHARS, '\\$1') : v;
  });
}

function escapeHtml(s: string) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}

// Inline style tags: {color:#f00}text{/color}. Values are checked against a
// strict allow-list so text (or a variable value) can never inject CSS or HTML.
const STYLE_TAGS: Record<string, (v: string) => string | null> = {
  color: (v) => `color:${toCssColor(v, '')}`,
  bg: (v) => `background-color:${toCssColor(v, '')};padding:0 .12em;border-radius:.12em`,
  size: (v) => `font-size:${/^\d+(\.\d+)?$/.test(v) ? `${v}%` : v}`,
  weight: (v) => (/^\d{3}$/.test(v) ? `font-weight:${v}` : null),
  font: (v) => `font-family:${v}`,
};
const SAFE_VALUE = /^[#\w\s(),.%-]+$/;

function inlineFormat(s: string) {
  return s
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\*([\s\S]+?)\*/g, '<em>$1</em>')
    // _italic_ only at word edges, so snake_case names and values are left alone
    .replace(/(^|[^\w])_(?=\S)([\s\S]*?\S)_(?!\w)/g, '$1<em>$2</em>')
    .replace(/\+\+([\s\S]+?)\+\+/g, '<u>$1</u>')
    .replace(/~~([\s\S]+?)~~/g, '<s>$1</s>')
    .replace(/\{(\w+):([^{}]*)\}/g, (m, tag: string, value: string) => {
      const css = STYLE_TAGS[tag] && SAFE_VALUE.test(value.trim()) ? STYLE_TAGS[tag](value.trim()) : null;
      return css ? `<span style="${css}">` : STYLE_TAGS[tag] ? '<span>' : m;
    })
    .replace(/\{\/(\w+)\}/g, (m, tag: string) => (STYLE_TAGS[tag] ? '</span>' : m));
}

// HTML-safe formatting for text layers:
//   **bold**  _italic_ (or *italic*)  ++underline++  ~~strike~~
//   {color:#f00}…{/color}  {bg:#ff0}…{/bg}  {size:150%}…{/size}  {weight:300}…{/weight}  {font:Oswald}…{/font}
//   single line break (Enter or "\n") = new line; blank line = new paragraph (<p>)
export function renderMarkdown(text: string): string {
  const stash: string[] = [];
  let s = text.replace(/\\([*\\_~+{}])/g, (_m, c: string) => `\u0000${stash.push(c) - 1}\u0000`);
  s = escapeHtml(s).replace(/\\n/g, '\n').replace(/\r\n?/g, '\n');
  // unbalanced tags inside a paragraph are closed by the browser at </p>
  s = s
    .split(/\n[ \t]*\n/)
    .map((para) => `<p>${inlineFormat(para).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return s.replace(/\u0000(\d+)\u0000/g, (_m, i: string) => escapeHtml(stash[+i]));
}

// Companion often exposes colors as decimal integers (e.g. 16711680) or
// "rgb(r,g,b)". Normalize anything usable into a CSS color string.
export function toCssColor(value: string, fallback = 'transparent'): string {
  const v = (value || '').trim();
  if (!v) return fallback;
  if (/^\d+$/.test(v)) return `#${(parseInt(v, 10) & 0xffffff).toString(16).padStart(6, '0')}`;
  if (/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(v)) return `#${v}`;
  return v;
}
