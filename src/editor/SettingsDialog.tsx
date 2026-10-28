import { useRef, useState } from 'react';
import type { Project } from '../types';
import { api } from '../lib/api';
import { uid } from '../lib/defaults';
import { migrate, useStore } from '../lib/store';
import { saveTextFile } from '../lib/saveFile';
import { NumberField, Row, Section, TextField } from './fields';

export function SettingsDialog({ onClose }: { onClose: () => void }) {
  const { project, mutate, replace } = useStore();
  const [tests, setTests] = useState<Record<number, string>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const [exported, setExported] = useState('');

  const test = async (i: number) => {
    setTests((t) => ({ ...t, [i]: 'Testing…' }));
    // make sure the server has the URL being tested
    await api.save(project).catch(() => {});
    const r = await api.testConnection(i).catch((e) => ({ ok: false, error: String(e.message), sample: '' }));
    setTests((t) => ({ ...t, [i]: r.ok ? `Connected (time ${r.sample})` : `Failed: ${r.error}` }));
  };

  return (
    <div className="modal-backdrop" onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="modal">
        <div className="modal-head">
          <h2>Settings</h2>
          <button className="icon" onClick={onClose}>✕</button>
        </div>

        <Section title="Companion connections">
          <p className="muted small">
            Connection <code>[0]</code> is the default: <code>$(internal:time_hms)</code>. Use <code>[1]$(…)</code>, <code>[2]$(…)</code>
            for the others. Companion’s HTTP API is usually on port 8000.
          </p>
          {project.connections.map((c, i) => (
            <div key={c.id} className="connection">
              <span className="conn-index">[{i}]</span>
              <input value={c.label} placeholder="Label" onChange={(e) => mutate((p) => (p.connections[i].label = e.target.value))} />
              <input className="grow" value={c.url} placeholder="http://192.168.1.10:8000" onChange={(e) => mutate((p) => (p.connections[i].url = e.target.value))} />
              <button onClick={() => test(i)}>Test</button>
              {project.connections.length > 1 && (
                <button className="icon danger" title="Remove" onClick={() => mutate((p) => p.connections.splice(i, 1))}>✕</button>
              )}
              {tests[i] && <span className={`test-result${tests[i].startsWith('Connected') ? ' ok' : ''}`}>{tests[i]}</span>}
            </div>
          ))}
          <button onClick={() => mutate((p) => p.connections.push({ id: uid(), label: `Companion ${p.connections.length + 1}`, url: '' }))}>
            + Add connection
          </button>
        </Section>

        <Section title="Display">
          <Row label="Refresh rate" hint="How often variables are polled">
            <NumberField value={project.settings.refreshMs} min={50} max={10000} step={50} suffix="ms" onChange={(v) => mutate((p) => (p.settings.refreshMs = v))} />
          </Row>
          <Row label="Color fade" hint="0 = instant changes">
            <NumberField value={project.settings.transitionMs} min={0} max={2000} step={50} suffix="ms" onChange={(v) => mutate((p) => (p.settings.transitionMs = v))} />
          </Row>
          <Row label="Default font">
            <TextField value={project.settings.font} onChange={(v) => mutate((p) => (p.settings.font = v))} preview={false} />
          </Row>
        </Section>

        <Section title="Backup">
          <p className="muted small">Export everything (screens, templates, connections) to a file, or replace this project with one.</p>
          <span className="btn-row">
            <button onClick={async () => {
              const name = await saveTextFile(
                `feedback-alley-${new Date().toISOString().slice(0, 10)}.json`,
                JSON.stringify(project, null, 2),
                'Feedback Alley project',
              );
              if (name) setExported(`Exported to ${name}`);
            }}>Export…</button>
            <button onClick={() => fileInput.current?.click()}>Import…</button>
            {exported && <span className="muted small">{exported}</span>}
          </span>
          <input
            ref={fileInput}
            type="file"
            accept="application/json,.json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = '';
              if (!file) return;
              try {
                const data = JSON.parse(await file.text()) as Project;
                if (!Array.isArray(data.screens)) throw new Error('Not a Feedback Alley export');
                if (confirm('Replace the current project with this file? (You can undo.)')) replace(migrate(data));
              } catch (err) {
                alert(`Import failed: ${(err as Error).message}`);
              }
            }}
          />
          <p className="muted small">Note: uploaded images live in the data folder’s <code>assets</code> folder and are not inside the export.</p>
        </Section>
      </div>
    </div>
  );
}
