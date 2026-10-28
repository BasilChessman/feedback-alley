// Geometry convention: every x/y/w/h is a percentage of its parent
// (blocks -> screen, layers -> block). That is what makes a layout render
// identically at 1280x720, 1920x1080 or 3840x2160, and what makes layers
// follow their block when it is resized.
//
// Fixed-thickness values (border width, corner radius) are in "reference px":
// pixels as they would be on a 1920-wide render of the screen, scaled to the
// actual output width at render time.

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export type Operator =
  | '=='
  | '!='
  | '<'
  | '<='
  | '>'
  | '>='
  | 'contains'
  | '!contains'
  | 'empty'
  | '!empty';

export interface Condition {
  left: string; // text with $(conn:var) references
  op: Operator;
  right: string; // literal or $(conn:var)
}

// Everything a feedback rule can change. Each target only uses the keys it understands.
export interface StyleOverride {
  fill?: string;
  textColor?: string;
  borderColor?: string;
  background?: string; // layer background color
  opacity?: number; // 0-100
  visible?: boolean;
  flash?: boolean;
  text?: string;
}

export interface FeedbackRule {
  id: string;
  match: 'all' | 'any';
  conditions: Condition[];
  set: StyleOverride;
}

interface LayerBase extends Rect {
  id: string;
  name: string;
  opacity: number; // 0-100
  hidden: boolean; // hidden unless a rule sets visible
  rules: FeedbackRule[];
  // Background drawn behind the layer's content, clipped to the corner radius.
  bgColor: string; // '' = none
  bgImage: string; // '' = none; url, /uploads/..., may contain variables
  bgFit: 'contain' | 'cover' | 'fill';
  radius: number; // reference px
}

export interface TextLayer extends LayerBase {
  type: 'text';
  text: string;
  font: string; // '' = project default
  sizeMode: 'fit' | 'fixed';
  fontSize: number; // fixed: % of layer height; fit: maximum % of layer height
  weight: number;
  italic: boolean;
  color: string;
  align: 'left' | 'center' | 'right';
  valign: 'top' | 'middle' | 'bottom';
  wrap: boolean;
  padding: number; // % of layer height
  lineHeight: number; // multiple of the font size
  paraSpacing: number; // extra space between paragraphs (blank line in the text), in em
}

export interface ShapeLayer extends LayerBase {
  type: 'shape';
  fill: string;
  borderWidth: number; // reference px
  borderColor: string;
}

export interface ImageLayer extends LayerBase {
  type: 'image';
  src: string; // url, /uploads/..., may contain variables
  fit: 'contain' | 'cover' | 'fill';
}

export interface BarThreshold {
  at: string; // number, % or time (e.g. "0:30"), depending on the bar
  color: string;
}

export interface BarLayer extends LayerBase {
  type: 'bar';
  // 'value': a number between min and max. 'remaining' / 'elapsed': a time,
  // shown as progress through `duration` (a countdown fills as it runs down).
  source: 'value' | 'remaining' | 'elapsed';
  value: string; // usually a variable
  min: number;
  max: number;
  duration: string; // time or variable, for time sources
  timeUnit: 's' | 'ms'; // what plain numbers mean for time sources
  smooth: boolean; // animate between once-a-second time updates
  reverse: boolean; // empty instead of fill
  direction: 'right' | 'left' | 'up' | 'down';
  fill: string;
  track: string;
  // Fill color changes as the bar reaches each point; the furthest one reached wins.
  thresholdMode: 'absolute' | 'percent';
  thresholds: BarThreshold[];
}

// A layer that holds other layers: a "block within a block". Children are
// positioned in % of the group, so they follow it when it's moved or resized.
export interface GroupLayer extends LayerBase {
  type: 'group';
  layers: Layer[]; // paint order: last is on top
  clip: boolean;
  borderWidth: number; // reference px
  borderColor: string;
}

export type Layer = TextLayer | ShapeLayer | ImageLayer | BarLayer | GroupLayer;
export type LayerType = Layer['type'];

export interface PressAction {
  connection: number;
  location: string; // "page/row/column"
}

export interface Block extends Rect {
  id: string;
  name: string;
  fill: string;
  borderColor: string;
  borderWidth: number;
  radius: number;
  opacity: number;
  hidden: boolean;
  clip: boolean;
  rules: FeedbackRule[];
  layers: Layer[]; // paint order: last is on top
  press?: PressAction;
}

export interface Screen {
  id: string;
  name: string;
  aspectW: number;
  aspectH: number;
  background: string;
  backgroundImage: string;
  backgroundFit: 'contain' | 'cover' | 'fill';
  rules: FeedbackRule[];
  blocks: Block[]; // paint order: last is on top
  outputPort?: number; // serve this screen alone at http://host:<port>/ (0/unset = off)
  pxWidth?: number; // design width in px (height follows the aspect); unset = 1920
}

// A saved group of one or more blocks. Geometry is kept exactly as it was on
// the source screen together with that screen's aspect, so inserting into a
// screen with a different ratio can keep the blocks' real proportions.
export interface Template {
  id: string;
  name: string;
  sourceAspect: number;
  sourcePxWidth?: number; // unset = 1920
  blocks: Block[];
  createdAt: string;
}

export interface Connection {
  id: string;
  label: string;
  url: string;
}

export interface Settings {
  refreshMs: number;
  font: string;
  transitionMs: number;
  snap: boolean;
  grid: number; // % step, 0 = off
  units: '%' | 'px'; // how positions and sizes are shown and typed in the editor
  gridPx: number; // grid step in px mode, 0 = whole pixels only
}

export interface Project {
  version: 1;
  connections: Connection[]; // index 0 is the default; [n]$(...) picks another
  screens: Screen[];
  templates: Template[];
  settings: Settings;
}

export type Values = Record<string, string | null>;
