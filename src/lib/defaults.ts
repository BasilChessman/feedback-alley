import { DEFAULT_PX_WIDTH, scaleStrokes, screenPx } from './pixels';
import type { Block, FeedbackRule, Layer, LayerType, Project, Screen, Template } from '../types';

export const uid = () => Math.random().toString(36).slice(2, 10);

export const ASPECT_PRESETS: { label: string; w: number; h: number }[] = [
  { label: '16:9 (HD / UHD)', w: 16, h: 9 },
  { label: '16:10', w: 16, h: 10 },
  { label: '4:3', w: 4, h: 3 },
  { label: '21:9', w: 21, h: 9 },
  { label: '32:9', w: 32, h: 9 },
  { label: '1:1', w: 1, h: 1 },
  { label: '9:16 (portrait)', w: 9, h: 16 },
];

export const RESOLUTIONS: Record<string, [number, number][]> = {
  '16:9': [[1280, 720], [1920, 1080], [2560, 1440], [3840, 2160]],
  '16:10': [[1280, 800], [1920, 1200], [2560, 1600]],
  '4:3': [[1024, 768], [1600, 1200]],
  '21:9': [[2560, 1080], [3440, 1440]],
  '32:9': [[3840, 1080], [5120, 1440]],
  '9:16': [[1080, 1920], [2160, 3840]],
};

export function newRule(): FeedbackRule {
  return { id: uid(), match: 'all', conditions: [{ left: '', op: '==', right: '' }], set: {} };
}

export function newLayer(type: LayerType): Layer {
  const base = {
    id: uid(), x: 0, y: 0, w: 100, h: 100, opacity: 100, hidden: false, rules: [],
    bgColor: '', bgImage: '', bgFit: 'cover' as const, radius: 0,
  };
  switch (type) {
    case 'text':
      return {
        ...base, type, name: 'Text', x: 5, y: 10, w: 90, h: 80,
        text: 'Text', font: '', sizeMode: 'fit', fontSize: 70, weight: 600, italic: false,
        color: '#ffffff', align: 'center', valign: 'middle', wrap: true, padding: 0, lineHeight: 1.12, paraSpacing: 0.4,
      };
    case 'shape':
      return { ...base, type, name: 'Shape', fill: '#2d6cdf', borderWidth: 0, borderColor: '#ffffff' };
    case 'image':
      return { ...base, type, name: 'Image', src: '', fit: 'contain' };
    case 'group':
      return { ...base, type, name: 'Group', layers: [], clip: true, borderWidth: 0, borderColor: '#ffffff' };
    case 'bar':
      return {
        ...base, type, name: 'Bar', y: 80, h: 20,
        source: 'value', value: '50', min: 0, max: 100, duration: '', timeUnit: 's', smooth: true, reverse: false,
        direction: 'right', fill: '#2fbf71', track: '#ffffff22', thresholdMode: 'absolute', thresholds: [],
      };
  }
}

export function newBlock(rect?: Partial<Block>): Block {
  const title = { ...(newLayer('text') as Extract<Layer, { type: 'text' }>), name: 'Label', text: 'Label' };
  return {
    id: uid(), name: 'Block', x: 10, y: 10, w: 25, h: 20,
    fill: '#1f2633', borderColor: '#3a4558', borderWidth: 2, radius: 12,
    opacity: 100, hidden: false, clip: true, rules: [], layers: [title],
    ...rect,
  };
}

export function newScreen(name = 'Screen 1', w = 16, h = 9): Screen {
  return {
    id: uid(), name, aspectW: w, aspectH: h, pxWidth: w >= h ? 1920 : 1080,
    background: '#0b0e14', backgroundImage: '', backgroundFit: 'cover',
    rules: [], blocks: [],
  };
}

// Fresh ids all the way down so copies never share identity with the original.
export function cloneBlock(b: Block): Block {
  const c: Block = structuredClone(b);
  c.id = uid();
  c.rules.forEach((r) => (r.id = uid()));
  c.layers = c.layers.map(cloneLayer);
  return c;
}

export function cloneLayer(l: Layer): Layer {
  const c: Layer = structuredClone(l);
  const renew = (x: Layer) => {
    x.id = uid();
    x.rules.forEach((r) => (r.id = uid()));
    if (x.type === 'group') x.layers.forEach(renew);
  };
  renew(c);
  return c;
}

export function boundsOf(rects: { x: number; y: number; w: number; h: number }[]) {
  const x = Math.min(...rects.map((r) => r.x));
  const y = Math.min(...rects.map((r) => r.y));
  const r = Math.max(...rects.map((r) => r.x + r.w));
  const b = Math.max(...rects.map((r) => r.y + r.h));
  return { x, y, w: r - x, h: b - y };
}

// Place a template's blocks onto a screen. When the screen's aspect differs
// from the one the template was saved on, horizontal % values are rescaled so
// blocks keep their physical shape, then the group is fitted on screen.
export function instantiateTemplate(t: Template, screen: Screen): Block[] {
  const blocks = t.blocks.map(cloneBlock);
  scaleStrokes(blocks, screenPx(screen).w / (t.sourcePxWidth || DEFAULT_PX_WIDTH));
  if (blocks.length === 0) return blocks;
  const k = t.sourceAspect / (screen.aspectW / screen.aspectH);
  const bb = boundsOf(blocks);
  let gw = bb.w * k;
  let gh = bb.h;
  const fit = Math.min(1, 100 / gw, 100 / gh);
  gw *= fit;
  gh *= fit;
  const gx = Math.min(Math.max(0, bb.x * k), 100 - gw);
  const gy = Math.min(Math.max(0, bb.y), 100 - gh);
  for (const b of blocks) {
    b.x = gx + (b.x - bb.x) * k * fit;
    b.y = gy + (b.y - bb.y) * fit;
    b.w = b.w * k * fit;
    b.h = b.h * fit;
  }
  return blocks;
}

// Same as instantiateTemplate, but centers the group on (cx, cy) in screen %,
// kept fully on screen.
export function instantiateTemplateAt(t: Template, screen: Screen, cx: number, cy: number): Block[] {
  const blocks = instantiateTemplate(t, screen);
  if (blocks.length === 0) return blocks;
  const bb = boundsOf(blocks);
  const x = Math.min(Math.max(0, cx - bb.w / 2), 100 - bb.w);
  const y = Math.min(Math.max(0, cy - bb.h / 2), 100 - bb.h);
  for (const b of blocks) {
    b.x += x - bb.x;
    b.y += y - bb.y;
  }
  return blocks;
}

export function newProject(): Project {
  const screen = newScreen();
  const clock = newBlock({ name: 'Clock', x: 35, y: 38, w: 30, h: 24 });
  const label = clock.layers[0] as Extract<Layer, { type: 'text' }>;
  label.text = '$(internal:time_hms)';
  label.name = 'Time';
  screen.blocks.push(clock);
  return {
    version: 1,
    connections: [{ id: uid(), label: 'Companion', url: 'http://127.0.0.1:8000' }],
    screens: [screen],
    templates: [],
    settings: { refreshMs: 250, font: 'Inter, "Helvetica Neue", Arial, sans-serif', transitionMs: 150, snap: true, grid: 0, units: '%', gridPx: 0 },
  };
}
