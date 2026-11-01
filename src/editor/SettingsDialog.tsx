import { useEffect, useRef, useState } from 'react';
import type { Project } from '../types';
import { api, type AppInfo } from '../lib/api';
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

        <Section title="Editor address">
          <EditorAddress />
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

// Where the editor and displays are reached, and (in the desktop app) the port.
function EditorAddress() {
  const [info, setInfo] = useState<AppInfo | null>(null);
  const [failed, setFailed] = useState('');
  const [port, setPort] = useState(0);
  const [copied, setCopied] = useState('');
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () =>
    api.appInfo().then(
      (i) => {
        setInfo(i);
        setPort(i.envPort ?? i.savedPort ?? i.port);
      },
      (e) => setFailed(String(e.message)),
    );
  useEffect(() => {
    load();
  }, []);

  if (!info) return <p className="muted small">{failed ? `Couldn’t read the address: ${failed}` : 'Loading…'}</p>;

  const editable = info.configurable && info.envPort == null;
  const pending = editable && info.savedPort != null && info.savedPort !== info.port;
  const copy = (u: string) => {
    navigator.clipboard?.writeText(u);
    setCopied(u);
    setTimeout(() => setCopied((c) => (c === u ? '' : c)), 1500);
  };
  const save = async (restart: boolean) => {
    setBusy(true);
    setMsg(null);
    try {
      await api.setAppPort(port);
      if (!restart) {
        setMsg({ ok: true, text: `Saved. Feedback Alley will use port ${port} the next time it starts.` });
        await load();
        return;
      }
      await api.restartApp();
      setMsg({ ok: true, text: `Restarting on port ${port}…` });
      // a browser on another computer follows to the new address
      setTimeout(() => (location.href = `${location.protocol}//${location.hostname}:${port}/`), 4000);
    } catch (e) {
      setMsg({ ok: false, text: (e as Error).message });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <p className="muted small">Open the editor, or any display, from another computer or device on the same network at:</p>
      <div className="addr-list">
        {info.urls.map((u, i) => (
          <div key={u} className="addr-row">
            <code>{u}</code>
            {i === 0 && <span className="muted small">this computer only</span>}
            <button className="small" onClick={() => copy(u)}>{copied === u ? 'Copied' : 'Copy'}</button>
          </div>
        ))}
        {info.urls.length === 1 && <p className="muted small">No network connection found, so only this computer can reach it.</p>}
      </div>
      <Row label="Port" hint={editable ? 'Default 8090. Takes effect when Feedback Alley restarts.' : undefined}>
        {editable ? (
          <span className="btn-row">
            <NumberField value={port} onChange={(v) => { setPort(Math.round(v)); setMsg(null); }} />
            <button disabled={busy || port === info.savedPort} onClick={() => save(false)}>Save</button>
            <button className="primary" disabled={busy || (port === info.port && !pending)} onClick={() => save(true)}>Save &amp; restart</button>
          </span>
        ) : (
          <span className="addr-port">{info.port}</span>
        )}
      </Row>
      {pending && !msg && (
        <p className="muted small">
          Set to {info.savedPort}, but running on {info.port}: either port {info.savedPort} was busy when Feedback Alley started, or it
          was changed and Feedback Alley hasn’t restarted yet.
        </p>
      )}
      {msg && <p className={`small ${msg.ok ? 'ok-text' : 'error-text'}`}>{msg.text}</p>}
      {info.envPort != null && <p className="muted small">This port was set when Feedback Alley was started (PORT={info.envPort}), so it can’t be changed here.</p>}
      {!info.configurable && <p className="muted small">Running from the command line or in development: set the port with the <code>PORT</code> environment variable.</p>}
      {editable && (
        <p className="muted small">
          Changing the port changes every address above, so update bookmarks and displays that use them. Screens with their own
          output port keep it.
        </p>
      )}
    </>
  );
}
