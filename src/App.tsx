import { useEffect, useState, type ReactNode } from 'react';
import type { Project } from './types';
import { api } from './lib/api';
import { newProject } from './lib/defaults';
import { migrate, StoreProvider } from './lib/store';
import { Display, ScreenPicker } from './Display';
import { Editor } from './editor/Editor';

// Routes (hash-based so any static host / the bundled server works):
//   #/                   editor, first screen
//   #/edit/<screenId>    editor
//   #/display            screen picker
//   #/display/<screenId> full-screen output
function useHash() {
  const [hash, setHash] = useState(location.hash);
  useEffect(() => {
    const on = () => setHash(location.hash);
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);
  return hash.replace(/^#\/?/, '').split('/');
}

export function App() {
  const [section, id] = useHash();
  // Undefined until we know whether this port is a screen's own output port.
  const [outputScreen, setOutputScreen] = useState<string | null | undefined>(undefined);
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    // keep polling so reassigning the port to another screen takes effect live
    const poll = () =>
      api.output().then(
        (r) => !stopped && setOutputScreen(r.screenId),
        () => !stopped && setOutputScreen((s) => (s === undefined ? null : s)),
      ).finally(() => { if (!stopped) timer = setTimeout(poll, 2000); });
    poll();
    return () => { stopped = true; clearTimeout(timer); };
  }, []);

  if (outputScreen === undefined) return <div className="display-msg" />;
  // An output port shows its screen at "/", with nothing after the port.
  if (outputScreen) return <Display key={outputScreen} screenId={outputScreen} />;
  if (section === 'display') return id ? <Display screenId={id} /> : <Loaded>{(p) => <ScreenPicker project={p} />}</Loaded>;
  return (
    <Loaded>
      {(p) => (
        <StoreProvider initial={p}>
          <Editor screenId={section === 'edit' ? id ?? null : null} onOpenScreen={(sid) => (location.hash = `#/edit/${sid}`)} />
        </StoreProvider>
      )}
    </Loaded>
  );
}

// Loaded once per page so a first run creates exactly one default project.
let loading: Promise<Project> | null = null;
function loadProject() {
  loading ??= api.load().then(async (d) => {
    if (d.store) return migrate(d.store);
    const fresh = newProject();
    await api.save(fresh);
    return fresh;
  }).finally(() => setTimeout(() => (loading = null), 1000));
  return loading;
}

function Loaded({ children }: { children: (p: Project) => ReactNode }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  useEffect(() => {
    loadProject().then(setProject, (e) => setError(String(e.message)));
  }, []);
  if (error) return <div className="display-msg">Can’t reach the Feedback Alley server: {error}</div>;
  if (!project) return <div className="display-msg">Loading…</div>;
  return <>{children(project)}</>;
}
