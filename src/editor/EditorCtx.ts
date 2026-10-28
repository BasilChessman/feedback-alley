import { createContext, useContext } from 'react';
import type { Block, Layer, Project, Screen, Values } from '../types';
import type { ConnStatus } from '../lib/useLiveValues';

export interface Selection {
  blocks: string[];
  focus: string | null; // block whose layers are being edited
  path: string[]; // groups entered inside the focused block, outermost first
  layers: string[]; // selected layers inside the current container (block or deepest group)
}

export const EMPTY_SELECTION: Selection = { blocks: [], focus: null, path: [], layers: [] };
export const selectBlocks = (blocks: string[]): Selection => ({ blocks, focus: null, path: [], layers: [] });
export const selectLayers = (block: string, path: string[], layers: string[]): Selection => ({ blocks: [block], focus: block, path, layers });

export interface EditorCtxValue {
  project: Project;
  screen: Screen;
  values: Values;
  status: ConnStatus;
  sel: Selection;
  setSel: (s: Selection) => void;
  zoom: number; // 1 = screen fits the canvas area
  setZoom: (z: number) => void;
  mutate: (fn: (p: Project) => void, transient?: boolean) => void;
  beginGesture: () => void;
  updateScreen: (fn: (s: Screen) => void, transient?: boolean) => void;
  updateBlock: (id: string, fn: (b: Block) => void, transient?: boolean) => void;
  updateLayer: (blockId: string, layerId: string, fn: (l: Layer) => void, transient?: boolean) => void;
}

export const EditorCtx = createContext<EditorCtxValue | null>(null);
export const useEditor = () => useContext(EditorCtx)!;
