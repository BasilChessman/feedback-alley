import { useEffect, useMemo, useRef, useState } from 'react';
import type { Block, Project } from './types';
import { api } from './lib/api';
import { migrate } from './lib/store';
import { useLiveValues } from './lib/useLiveValues';
import { collectRefs } from './lib/variables';
import { FitStage, ScreenView } from './render/ScreenView';

const REV_POLL_MS = 1500;
const CURSOR_HIDE_MS = 2500;

// Full-window output for a screen. Letterboxes to keep the screen's aspect,
// follows edits made in the editor live, and hides the cursor when idle.
export function Display({ screenId }: { screenId: string }) {
  const [project, setProject] = useState<Project | null>(null);
  const [error, setError] = useState('');
  const rev = useRef(-1);

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const poll = async () => {
      try {
        const r = await api.rev();
        if (r.rev !== rev.current) {
          const data = await api.load();
          if (stopped) return;
          rev.current = data.rev;
          if (data.store) setProject(migrate(data.store));
        }
        setError('');
      } catch (e) {
        if (!stopped) setError(String((e as Error).message));
      }
      if (!stopped) timer = setTimeout(poll, REV_POLL_MS);
    };
    poll();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, []);

  useIdleCursor();

  const screen = project?.screens.find((s) => s.id === screenId);
  const refs = useMemo(() => (screen ? collectRefs(screen) : []), [screen]);
  const { values, serverDown } = useLiveValues(refs, project?.settings.refreshMs ?? 250);

  if (!project) return <div className="display-msg">{error ? `Can’t reach server: ${error}` : 'Loading…'}</div>;
  if (!screen) return <ScreenPicker project={project} missing />;

  const press = (b: Block) => {
    if (b.press) api.press(b.press.connection, b.press.location).catch(() => {});
  };

  return (
    <div
      className="display"
      onDoubleClick={() => (document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen()).catch(() => {})}
    >
      <FitStage aspect={screen.aspectW / screen.aspectH}>
        {(w) => <ScreenView screen={screen} width={w} values={values} settings={project.settings} onPress={press} />}
      </FitStage>
      {(serverDown || error) && <div className="offline-dot" title="Lost connection to the server" />}
    </div>
  );
}

export function ScreenPicker({ project, missing }: { project: Project; missing?: boolean }) {
  return (
    <div className="picker">
      <h1>Choose a screen to display</h1>
      {missing && <p className="muted">That screen no longer exists.</p>}
      <ul>
        {project.screens.map((s) => (
          <li key={s.id}>
            <a href={`#/display/${s.id}`}>{s.name}</a> <span className="muted">{s.aspectW}:{s.aspectH}</span>
          </li>
        ))}
      </ul>
      <p className="muted small">Tip: double-click the display to toggle full screen.</p>
      <p><a href="#/">Open the editor</a></p>
    </div>
  );
}

function useIdleCursor() {
  useEffect(() => {
    let t: ReturnType<typeof setTimeout>;
    const wake = () => {
      document.body.classList.remove('idle');
      clearTimeout(t);
      t = setTimeout(() => document.body.classList.add('idle'), CURSOR_HIDE_MS);
    };
    wake();
    window.addEventListener('pointermove', wake);
    return () => {
      clearTimeout(t);
      window.removeEventListener('pointermove', wake);
      document.body.classList.remove('idle');
    };
  }, []);
}
