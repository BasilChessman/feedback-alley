import type { Block, FeedbackRule, Layer } from '../types';
import { renameRefs } from './variables';

// The editable text in a block: its name, text layers, headers and text set by
// feedback rules. Paths are relative to the block, so they also find the same
// spot in a copy of it.
export interface TextSpot {
  id: string; // "<block index>:<path>"
  block: number; // index in the list of blocks given
  path: (string | number)[];
  label: string;
  text: string;
}

export function collectTexts(blocks: Block[]): TextSpot[] {
  const out: TextSpot[] = [];
  blocks.forEach((b, bi) => {
    // with several blocks, say which one each piece of text is in
    const prefix = blocks.length > 1 ? `${b.name} › ` : '';
    const add = (path: (string | number)[], label: string, text: string | undefined) => {
      if (text != null) out.push({ id: `${bi}:${path.join('.')}`, block: bi, path, label: prefix + label, text });
    };
    add(['name'], 'Block name', b.name);
    const rules = (rs: FeedbackRule[], base: (string | number)[], owner: string) =>
      rs.forEach((r, i) => {
        add([...base, 'rules', i, 'set', 'text'], `${owner} · rule ${i + 1}`, r.set.text);
        add([...base, 'rules', i, 'set', 'headerText'], `${owner} · rule ${i + 1} header`, r.set.headerText);
      });
    const walk = (layers: Layer[], base: (string | number)[]) =>
      layers.forEach((l, i) => {
        const at = [...base, 'layers', i];
        if (l.type === 'text') add([...at, 'text'], l.name, l.text);
        if (l.header) add([...at, 'header', 'text'], `${l.name} · header`, l.header.text);
        rules(l.rules, at, l.name);
        if (l.type === 'group') walk(l.layers, at);
      });
    walk(b.layers, []);
  });
  return out;
}

function setAt(obj: unknown, path: (string | number)[], value: string) {
  let o = obj as Record<string | number, unknown>;
  for (const k of path.slice(0, -1)) {
    if (!o || typeof o !== 'object') return;
    o = o[k] as Record<string | number, unknown>;
  }
  if (o && typeof o === 'object') o[path[path.length - 1]] = value;
}

// Apply text edits (by TextSpot id) and then variable renames to one block,
// the block at index bi of the list the spots were collected from.
export function retargetBlock(b: Block, bi: number, texts: Record<string, string>, renames: Record<string, string>) {
  for (const [id, text] of Object.entries(texts)) {
    const [i, path] = [Number(id.slice(0, id.indexOf(':'))), id.slice(id.indexOf(':') + 1)];
    if (i === bi) setAt(b, path.split('.').map((k) => (/^\d+$/.test(k) ? Number(k) : k)), text);
  }
  renameRefs(b, renames);
}
