import type { ShapeKind, ShapeLayer } from '../types';

type Pt = [number, number];
type Pointing = NonNullable<ShapeLayer['pointing']>;

export const SHAPE_KINDS: { value: ShapeKind; label: string }[] = [
  { value: 'rect', label: 'Rectangle' },
  { value: 'ellipse', label: 'Circle / ellipse' },
  { value: 'triangle', label: 'Triangle' },
  { value: 'diamond', label: 'Diamond' },
  { value: 'pentagon', label: 'Pentagon' },
  { value: 'hexagon', label: 'Hexagon' },
  { value: 'octagon', label: 'Octagon' },
  { value: 'star', label: 'Star' },
  { value: 'arrow', label: 'Arrow' },
];

// Shapes that point somewhere, and which way they point by default.
export const POINTED: Partial<Record<ShapeKind, Pointing>> = { triangle: 'up', arrow: 'right' };

// Points around a circle, starting at the top, stretched to fill 0..100.
function radial(n: number, inner?: number): Pt[] {
  const pts: Pt[] = [];
  const count = inner ? n * 2 : n;
  for (let i = 0; i < count; i++) {
    const a = -Math.PI / 2 + (i * Math.PI * 2) / count;
    const r = inner && i % 2 ? inner : 1;
    pts.push([Math.cos(a) * r, Math.sin(a) * r]);
  }
  const xs = pts.map((p) => p[0]);
  const ys = pts.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  return pts.map(([x, y]) => [((x - x0) / (x1 - x0)) * 100, ((y - y0) / (y1 - y0)) * 100]);
}

const C = 29.29; // octagon corner cut, so its sides are equal in a square
// Drawn pointing up; turned for the other directions.
const UP: Partial<Record<ShapeKind, Pt[]>> = {
  triangle: [[50, 0], [100, 100], [0, 100]],
  arrow: [[50, 0], [100, 45], [70, 45], [70, 100], [30, 100], [30, 45], [0, 45]],
};
const FIXED: Partial<Record<ShapeKind, Pt[]>> = {
  diamond: [[50, 0], [100, 50], [50, 100], [0, 50]],
  pentagon: radial(5),
  hexagon: [[25, 0], [75, 0], [100, 50], [75, 100], [25, 100], [0, 50]],
  octagon: [[C, 0], [100 - C, 0], [100, C], [100, 100 - C], [100 - C, 100], [C, 100], [0, 100 - C], [0, C]],
  star: radial(5, 0.4),
};

const TURN: Record<Pointing, (p: Pt) => Pt> = {
  up: (p) => p,
  right: ([x, y]) => [100 - y, x],
  down: ([x, y]) => [100 - x, 100 - y],
  left: ([x, y]) => [y, 100 - x],
};

// SVG polygon points in a 0..100 box, or null for shapes drawn with CSS.
export function shapePoints(layer: ShapeLayer): string | null {
  const kind = layer.kind ?? 'rect';
  const up = UP[kind];
  const pts = up ? up.map(TURN[layer.pointing ?? POINTED[kind] ?? 'up']) : FIXED[kind];
  return pts ? pts.map(([x, y]) => `${+x.toFixed(2)},${+y.toFixed(2)}`).join(' ') : null;
}
