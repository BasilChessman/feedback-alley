import type { CSSProperties } from 'react';
import type { FlashPart, FlashSpec, StyleOverride } from '../types';

export const FLASH_SPEEDS = [
  { value: 2, label: 'Slow' },
  { value: 1, label: 'Normal' },
  { value: 0.5, label: 'Fast' },
];

export const FLASH_PART_LABELS: Record<FlashPart, string> = {
  all: 'Whole',
  fill: 'Fill',
  border: 'Border',
  text: 'Text',
  background: 'Background',
  header: 'Header',
};

export const newFlash = (): FlashSpec => ({ parts: ['all'], color: '', speed: 1 });

// A rule's flash setting, with older projects' `flash: true` read as "blink the whole item".
export function flashSpec(v: StyleOverride['flash']): FlashSpec | null {
  if (!v) return null;
  if (v === true) return newFlash();
  return v.parts.length ? v : null;
}

// Keyframes in styles.css. Every part flashes in step: same timing, half on, half off.
const KEYFRAMES = {
  all: 'flash',
  hide: 'flash-hide',
  fill: 'flash-bg',
  background: 'flash-bg',
  border: 'flash-border',
} as const;

// Inline animation for one element, flashing the given parts of it.
export function flashAnim(f: FlashSpec | null, parts: FlashPart[]): CSSProperties | undefined {
  if (!f) return undefined;
  const names = parts
    .filter((p) => f.parts.includes(p))
    .map((p) => (p === 'header' ? (f.color ? KEYFRAMES.fill : KEYFRAMES.hide) : KEYFRAMES[p as keyof typeof KEYFRAMES]))
    .filter(Boolean);
  if (!names.length) return undefined;
  return { animation: names.map((n) => `${n} ${f.speed}s steps(1, end) infinite`).join(', ') };
}

// Custom properties the keyframes read; set on the item so its parts inherit them.
export function flashVars(f: FlashSpec | null): CSSProperties | undefined {
  if (!f) return undefined;
  return { ['--flash-color' as string]: f.color || 'transparent', ['--flash-speed' as string]: `${f.speed}s` };
}

// Text flashes through a class, so text with its own inline colors flashes too.
export const flashTextCls = (f: FlashSpec | null) => (f?.parts.includes('text') ? ' flash-text' : '');
