import type { Layer, LayerHeader, Rect } from '../types';

export const HEADER_MIN = 5;
export const HEADER_MAX = 95;

export function newHeader(): LayerHeader {
  return {
    enabled: true, side: 'top', size: 25, fill: '#2d6cdf',
    text: 'Header', font: '', sizeMode: 'fit', fontSize: 70, weight: 700, italic: false, color: '#ffffff',
    align: 'center', valign: 'middle', wrap: false, padding: 10, lineHeight: 1.12, paraSpacing: 0.4,
  };
}

// Groups lay their children out over the whole group, so they don't get headers.
export const supportsHeader = (l: Layer) => l.type !== 'group';

export const activeHeader = (l: Layer) => (supportsHeader(l) && l.header?.enabled ? l.header : null);

// The header strip and the remaining content area, in % of the layer.
export function headerRects(h: LayerHeader): { header: Rect; content: Rect } {
  const s = Math.max(HEADER_MIN, Math.min(HEADER_MAX, h.size));
  switch (h.side) {
    case 'top':
      return { header: { x: 0, y: 0, w: 100, h: s }, content: { x: 0, y: s, w: 100, h: 100 - s } };
    case 'bottom':
      return { header: { x: 0, y: 100 - s, w: 100, h: s }, content: { x: 0, y: 0, w: 100, h: 100 - s } };
    case 'left':
      return { header: { x: 0, y: 0, w: s, h: 100 }, content: { x: s, y: 0, w: 100 - s, h: 100 } };
    case 'right':
      return { header: { x: 100 - s, y: 0, w: s, h: 100 }, content: { x: 0, y: 0, w: 100 - s, h: 100 } };
  }
}
