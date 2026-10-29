import { useState } from 'react';
import { newScreen, uid } from '../lib/defaults';
import type { Screen } from '../types';
import { selectBlocks, selectLayers, useEditor } from './EditorCtx';
import { templateDrag, TEMPLATE_MIME, useActions } from './actions';
import { Section } from './fields';
import { askText } from './askText';

export function Sidebar({ onOpenScreen }: { onOpenScreen: (id: string) => void }) {
  return (
    <aside className="sidebar">
      <ScreensPanel onOpenScreen={onOpenScreen} />
      <BlocksPanel />
      <TemplatesPanel />
    </aside>
  );
}

function ScreensPanel({ onOpenScreen }: { onOpenScreen: (id: string) => void }) {
  const { project, screen, mutate } = useEditor();
  return (
    <Section
      title="Screens"
      actions={
        <button className="small" onClick={() => {
          const s = newScreen(`Screen ${project.screens.length + 1}`, screen.aspectW, screen.aspectH);
          mutate((p) => p.screens.push(s));
          onOpenScreen(s.id);
        }}>+ New</button>
      }
    >
      <ul className="item-list">
        {project.screens.map((s) => (
          <li key={s.id} className={s.id === screen.id ? 'selected' : ''} onClick={() => onOpenScreen(s.id)}>
            <span className="item-name">{s.name}</span>
            {s.outputPort
              ? <span className="port-badge" title={`${s.aspectW}:${s.aspectH}, served at port ${s.outputPort}`}>:{s.outputPort}</span>
              : <span className="muted small">{s.aspectW}:{s.aspectH}</span>}
            <a className="icon" href={`#/display/${s.id}`} target="_blank" rel="noreferrer" title="Open display" onClick={(e) => e.stopPropagation()}>↗</a>
            <button className="icon" title="Duplicate screen" onClick={(e) => {
              e.stopPropagation();
              const copy: Screen = { ...structuredClone(s), id: uid(), name: `${s.name} copy` };
              mutate((p) => p.screens.splice(p.screens.findIndex((x) => x.id === s.id) + 1, 0, copy));
              onOpenScreen(copy.id);
            }}>⧉</button>
            {project.screens.length > 1 && (
              <button className="icon danger" title="Delete screen" onClick={(e) => {
                e.stopPropagation();
                if (!confirm(`Delete screen "${s.name}"?`)) return;
                const next = project.screens.find((x) => x.id !== s.id)!;
                mutate((p) => (p.screens = p.screens.filter((x) => x.id !== s.id)));
                if (s.id === screen.id) onOpenScreen(next.id);
              }}>✕</button>
            )}
          </li>
        ))}
      </ul>
    </Section>
  );
}

function BlocksPanel() {
  const { screen, sel, setSel, updateBlock } = useEditor();
  const { addBlock } = useActions();
  const blocks = [...screen.blocks].reverse();
  return (
    <Section title="Blocks" actions={<button className="small" onClick={addBlock}>+ Block</button>}>
      {blocks.length === 0 && <p className="muted small">Add a block, then add text, shape, image or bar layers to it.</p>}
      <ul className="item-list">
        {blocks.map((b) => (
          <li
            key={b.id}
            className={sel.blocks.includes(b.id) ? 'selected' : ''}
            onClick={(e) => {
              const multi = e.shiftKey || e.metaKey;
              const ids = multi
                ? sel.blocks.includes(b.id) ? sel.blocks.filter((x) => x !== b.id) : [...sel.blocks, b.id]
                : [b.id];
              setSel(selectBlocks(ids));
            }}
            onDoubleClick={() => setSel(selectLayers(b.id, [], []))}
          >
            <span className="item-name">{b.name}</span>
            {(b.rules.length > 0 || b.layers.some((l) => l.rules.length)) && <span className="badge" title="Has feedback rules">ƒ</span>}
            {b.press && <span className="badge" title="Presses a Companion button">⏎</span>}
            {b.goTo && <span className="badge" title="Goes to another screen when clicked">→</span>}
            <button
              className={`icon eye${b.hidden ? ' off' : ''}`}
              title={b.hidden ? 'Hidden unless a rule shows it' : 'Visible'}
              onClick={(e) => {
                e.stopPropagation();
                updateBlock(b.id, (x) => (x.hidden = !x.hidden));
              }}
            >
              {b.hidden ? '◌' : '●'}
            </button>
          </li>
        ))}
      </ul>
    </Section>
  );
}

function TemplatesPanel() {
  const { project, screen, sel, mutate } = useEditor();
  const { insertTemplate, saveTemplate } = useActions();
  const [renaming, setRenaming] = useState<string | null>(null);
  return (
    <Section
      title="Templates"
      actions={
        sel.blocks.length > 0 && !sel.focus ? (
          <button className="small" title="Save the selected blocks as a reusable template" onClick={async () => {
            const name = await askText({ title: 'Save as template', label: 'Template name', value: sel.blocks.length > 1 ? 'Block group' : screen.blocks.find((b) => b.id === sel.blocks[0])?.name ?? 'Block', okLabel: 'Save' });
            if (name) saveTemplate(name);
          }}>+ Save selection</button>
        ) : undefined
      }
    >
      {project.templates.length === 0 && (
        <p className="muted small">Select one or more blocks and save them as a template to reuse them on any screen.</p>
      )}
      {project.templates.length > 0 && <p className="muted small">Drag a template onto the screen to place it.</p>}
      <ul className="item-list">
        {project.templates.map((t) => (
          <li
            key={t.id}
            className="template-item"
            title={`${t.name}: ${t.blocks.length} block${t.blocks.length === 1 ? '' : 's'}. Drag onto the screen, or Insert at its saved position`}
            draggable={renaming !== t.id}
            onDragStart={(e) => {
              templateDrag.id = t.id;
              e.dataTransfer.setData(TEMPLATE_MIME, t.id);
              e.dataTransfer.effectAllowed = 'copy';
            }}
            onDragEnd={() => (templateDrag.id = null)}
          >
            <span className="drag-grip" aria-hidden>⠿</span>
            <div className="template-body">
            {renaming === t.id ? (
              <input
                autoFocus
                onFocus={(e) => e.target.select()}
                defaultValue={t.name}
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (v) mutate((p) => (p.templates.find((x) => x.id === t.id)!.name = v));
                  setRenaming(null);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                  if (e.key === 'Escape') setRenaming(null);
                }}
              />
            ) : (
              <span className="template-name" title="Double-click to rename" onDoubleClick={() => setRenaming(t.id)}>{t.name}</span>
            )}
            <div className="template-actions">
              <span className="muted small">{t.blocks.length} block{t.blocks.length === 1 ? '' : 's'}</span>
              <span className="spacer" />
              <button className="small" title="Insert at the position it was saved" onClick={() => insertTemplate(t)}>Insert</button>
              <button className="icon danger" title="Delete template" onClick={() => {
                if (confirm(`Delete template "${t.name}"?`)) mutate((p) => (p.templates = p.templates.filter((x) => x.id !== t.id)));
              }}>✕</button>
            </div>
            </div>
          </li>
        ))}
      </ul>
    </Section>
  );
}
