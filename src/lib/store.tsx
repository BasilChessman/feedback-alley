import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { Block, Layer, Project } from '../types';
import { api } from './api';
import { newProject } from './defaults';
import { syncFixedLayers } from './fixed';

const HISTORY_LIMIT = 150;
const SAVE_DELAY_MS = 400;

export type SaveState = 'saved' | 'saving' | 'error';

interface StoreCtx {
  project: Project;
  // Apply an edit. Normal edits are one undo step each. During a drag, call
  // beginGesture() on the first move, then mutate(..., true) on every move:
  // the whole drag becomes a single undo step.
  mutate: (fn: (draft: Project) => void, transient?: boolean) => void;
  beginGesture: () => void;
  // For controls that only have a plain onChange (e.g. a color picker being
  // dragged): between holdHistory() and releaseHistory(), every edit merges
  // into one undo step.
  holdHistory: () => void;
  releaseHistory: () => void;
  replace: (p: Project) => void;
  undo: () => void;
  redo: () => void;
  canUndo: boolean;
  canRedo: boolean;
  saveState: SaveState;
}

const Ctx = createContext<StoreCtx | null>(null);

// For components that may render outside the editor (no store).
export const useOptionalStore = () => useContext(Ctx);

export function useStore() {
  const c = useContext(Ctx);
  if (!c) throw new Error('useStore outside StoreProvider');
  return c;
}

const LAYER_DEFAULTS = { bgColor: '', bgImage: '', bgFit: 'cover', radius: 0 } as const;
const TYPE_DEFAULTS: Partial<Record<Layer['type'], object>> = {
  text: { lineHeight: 1.12, paraSpacing: 0.4 },
  bar: { source: 'value', duration: '', timeUnit: 's', smooth: true, reverse: false, thresholdMode: 'absolute', thresholds: [] },
};
const migrateLayers = (layers: Layer[]): Layer[] =>
  layers.map((l) => {
    const m = { ...LAYER_DEFAULTS, ...TYPE_DEFAULTS[l.type], ...l } as Layer;
    if (m.type === 'group') m.layers = migrateLayers(m.layers || []);
    return m;
  });
const migrateBlocks = (blocks: Block[]) => blocks.map((b) => ({ ...b, layers: migrateLayers(b.layers || []) }));

// Fill in fields added after a project was saved, so older files keep loading.
export function migrate(p: Project): Project {
  const d = newProject();
  p = {
    ...p,
    screens: (p.screens || []).map((s) => ({ ...s, blocks: migrateBlocks(s.blocks || []) })),
    templates: (p.templates || []).map((t) => ({ ...t, blocks: migrateBlocks(t.blocks || []) })),
  };
  return {
    ...d,
    ...p,
    settings: { ...d.settings, ...p.settings },
    connections: p.connections?.length ? p.connections : d.connections,
    screens: p.screens?.length ? p.screens : d.screens,
    templates: p.templates || [],
  };
}

export function StoreProvider({ initial, children }: { initial: Project; children: ReactNode }) {
  const [project, setProject] = useState(initial);
  const [saveState, setSaveState] = useState<SaveState>('saved');
  const projectRef = useRef(project);
  // History lives in refs (not state) so updates never run twice under StrictMode.
  const past = useRef<Project[]>([]);
  const future = useRef<Project[]>([]);

  const commit = useCallback((next: Project) => {
    projectRef.current = next;
    setProject(next);
  }, []);

  const pushHistory = useCallback((snapshot: Project) => {
    past.current = [...past.current.slice(-HISTORY_LIMIT + 1), snapshot];
    future.current = [];
  }, []);

  // true while a control holds history: its edits merge into one undo step
  const held = useRef(false);

  const mutate = useCallback(
    (fn: (draft: Project) => void, transient = false) => {
      const prev = projectRef.current;
      const next = structuredClone(prev);
      fn(next);
      syncFixedLayers(next);
      if (!transient && !held.current) pushHistory(prev);
      commit(next);
    },
    [pushHistory, commit],
  );

  const beginGesture = useCallback(() => pushHistory(projectRef.current), [pushHistory]);
  const holdHistory = useCallback(() => {
    if (held.current) return;
    pushHistory(projectRef.current);
    held.current = true;
  }, [pushHistory]);
  const releaseHistory = useCallback(() => {
    held.current = false;
  }, []);

  const replace = useCallback(
    (p: Project) => {
      pushHistory(projectRef.current);
      commit(p);
    },
    [pushHistory, commit],
  );

  const undo = useCallback(() => {
    const prev = past.current.pop();
    if (!prev) return;
    future.current.unshift(projectRef.current);
    commit(prev);
  }, [commit]);

  const redo = useCallback(() => {
    const next = future.current.shift();
    if (!next) return;
    past.current.push(projectRef.current);
    commit(next);
  }, [commit]);

  // Autosave to the server (debounced). Displays pick the change up by polling /api/rev.
  const first = useRef(true);
  useEffect(() => {
    if (first.current) {
      first.current = false;
      return;
    }
    setSaveState('saving');
    const t = setTimeout(() => {
      api.save(project).then(
        () => setSaveState('saved'),
        () => setSaveState('error'),
      );
    }, SAVE_DELAY_MS);
    return () => clearTimeout(t);
  }, [project]);

  const value = useMemo<StoreCtx>(
    () => ({
      project, mutate, beginGesture, holdHistory, releaseHistory, replace, undo, redo,
      canUndo: past.current.length > 0, canRedo: future.current.length > 0, saveState,
    }),
    [project, mutate, beginGesture, holdHistory, releaseHistory, replace, undo, redo, saveState],
  );
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}
