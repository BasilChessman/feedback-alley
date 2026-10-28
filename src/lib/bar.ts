import type { BarLayer, Values } from '../types';
import { resolveText } from './variables';

// Parses a time such as "2:20", "01:02:20", "1:02:20.5", "-0:05", "140" or
// "00:02:20:12" (hh:mm:ss:ff, frames ignored). Plain numbers are seconds, or
// milliseconds when `unit` is 'ms'. Returns seconds, or NaN.
export function parseTime(raw: string, unit: 's' | 'ms' = 's'): number {
  const s = raw.trim();
  if (!s) return NaN;
  const neg = s.startsWith('-');
  const body = neg ? s.slice(1) : s;
  let secs: number;
  if (/^\d+(\.\d+)?$/.test(body)) {
    secs = Number(body) / (unit === 'ms' ? 1000 : 1);
  } else if (/^\d+(:\d{1,2}){1,3}(\.\d+)?$/.test(body)) {
    const parts = body.split(':').map(Number);
    if (parts.length === 4) parts.pop(); // frames
    secs = parts.reduce((acc, n) => acc * 60 + n, 0);
  } else {
    return NaN;
  }
  return neg ? -secs : secs;
}

export function formatTime(secs: number): string {
  if (!isFinite(secs)) return '–';
  const t = Math.max(0, Math.round(secs));
  const h = Math.floor(t / 3600);
  const m = Math.floor((t % 3600) / 60);
  const ss = String(t % 60).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
}

export interface BarReading {
  progress: number; // 0..1 before reversing; NaN when the value can't be read
  time?: number; // seconds remaining/elapsed (time sources)
  duration?: number; // seconds (time sources)
}

const clamp01 = (n: number) => Math.max(0, Math.min(1, n));

// How far along the bar is. For time sources, `time` can be passed in to
// override the variable (used for smooth in-between frames).
export function readBar(layer: BarLayer, values: Values, time?: number): BarReading {
  if (layer.source === 'value') {
    const raw = parseFloat(resolveText(layer.value, values));
    const span = layer.max - layer.min || 1;
    return { progress: isNaN(raw) ? NaN : clamp01((raw - layer.min) / span) };
  }
  const duration = parseTime(resolveText(layer.duration, values), layer.timeUnit);
  const t = time ?? parseTime(resolveText(layer.value, values), layer.timeUnit);
  if (!(duration > 0) || isNaN(t)) return { progress: NaN, time: t, duration };
  // A countdown fills as the time remaining runs down to 0.
  const done = layer.source === 'remaining' ? duration - t : t;
  return { progress: clamp01(done / duration), time: t, duration };
}

// Where a threshold sits on the bar, 0..1, so thresholds of any kind compare
// against the bar's progress. Time thresholds are in time remaining/elapsed.
function thresholdPoint(layer: BarLayer, at: string, duration?: number): number {
  if (layer.thresholdMode === 'percent') return parseFloat(at) / 100;
  if (layer.source === 'value') {
    return (parseFloat(at) - layer.min) / (layer.max - layer.min || 1);
  }
  const t = parseTime(at, layer.timeUnit);
  if (!duration || !(duration > 0)) return NaN;
  return layer.source === 'remaining' ? (duration - t) / duration : t / duration;
}

// Index of the furthest threshold the bar has reached (later ones win ties), or -1.
export function activeThreshold(layer: BarLayer, reading: BarReading): number {
  if (isNaN(reading.progress)) return -1;
  let best = -1;
  let bestPoint = -Infinity;
  layer.thresholds.forEach((th, i) => {
    const point = thresholdPoint(layer, th.at, reading.duration);
    if (isNaN(point) || point > reading.progress + 1e-9 || point < bestPoint) return;
    best = i;
    bestPoint = point;
  });
  return best;
}

export function thresholdColor(layer: BarLayer, reading: BarReading): string | undefined {
  return layer.thresholds[activeThreshold(layer, reading)]?.color;
}
