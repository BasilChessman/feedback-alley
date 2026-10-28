import { useEffect, useRef, useState } from 'react';
import type { Values } from '../types';
import { api } from './api';

export type ConnStatus = Record<string, 'ok' | 'error' | 'unconfigured'>;

// Polls the server for the given variable references. A new poll starts only
// after the previous one finishes, so a slow Companion never stacks requests.
export function useLiveValues(refs: string[], refreshMs: number) {
  const [values, setValues] = useState<Values>({});
  const [status, setStatus] = useState<ConnStatus>({});
  const [serverDown, setServerDown] = useState(false);
  const key = refs.join('\n');
  const refsRef = useRef(refs);
  refsRef.current = refs;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      const current = refsRef.current;
      if (current.length > 0) {
        try {
          const res = await api.variables(current);
          if (stopped) return;
          setValues((prev) => (sameValues(prev, res.values) ? prev : res.values));
          setStatus((prev) => (JSON.stringify(prev) === JSON.stringify(res.connections) ? prev : res.connections));
          setServerDown(false);
        } catch {
          if (!stopped) setServerDown(true);
        }
      }
      if (!stopped) timer = setTimeout(tick, Math.max(50, refreshMs));
    };
    tick();
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [key, refreshMs]);

  return { values, status, serverDown };
}

function sameValues(a: Values, b: Values) {
  const ak = Object.keys(a);
  if (ak.length !== Object.keys(b).length) return false;
  return ak.every((k) => a[k] === b[k]);
}
