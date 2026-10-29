import { useEffect, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';

// In-app replacement for window.prompt(), which the desktop app (Electron)
// doesn't support. Resolves with the trimmed text, or null if cancelled.
export function askText({ title, label, value = '', okLabel = 'OK' }: { title: string; label?: string; value?: string; okLabel?: string }): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const done = (result: string | null) => {
      root.unmount();
      host.remove();
      resolve(result);
    };
    root.render(<AskDialog title={title} label={label} value={value} okLabel={okLabel} onDone={done} />);
  });
}

function AskDialog({ title, label, value, okLabel, onDone }: { title: string; label?: string; value: string; okLabel: string; onDone: (v: string | null) => void }) {
  const [text, setText] = useState(value);
  const input = useRef<HTMLInputElement>(null);
  useEffect(() => {
    input.current?.focus();
    input.current?.select();
  }, []);
  const ok = () => {
    const v = text.trim();
    if (v) onDone(v);
  };
  return (
    <div
      className="modal-backdrop ask-backdrop"
      onPointerDown={(e) => e.target === e.currentTarget && onDone(null)}
      // keep keys (Esc, Delete, arrows...) away from the editor's shortcuts
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Escape') onDone(null);
        if (e.key === 'Enter') ok();
      }}
    >
      <div className="modal ask-dialog" role="dialog" aria-label={title}>
        <div className="modal-head"><h2>{title}</h2></div>
        <div className="ask-body">
          {label && <label htmlFor="ask-input" className="muted small">{label}</label>}
          <input id="ask-input" ref={input} value={text} onChange={(e) => setText(e.target.value)} />
          <span className="btn-row ask-actions">
            <button onClick={() => onDone(null)}>Cancel</button>
            <button className="primary" disabled={!text.trim()} onClick={ok}>{okLabel}</button>
          </span>
        </div>
      </div>
    </div>
  );
}
