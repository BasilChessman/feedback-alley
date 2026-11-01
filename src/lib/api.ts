import type { Project, Values } from '../types';

async function req<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  if (!res.ok) throw new Error(`${init?.method || 'GET'} ${url}: HTTP ${res.status}`);
  return res.json() as Promise<T>;
}

const post = (body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(body),
});

export interface AppInfo {
  port: number; // the port the editor is running on
  urls: string[]; // localhost first, then this computer's network addresses
  configurable: boolean; // desktop app: the port can be changed from Settings
  savedPort: number | null; // port it starts on next time
  envPort: number | null; // set by PORT when started; overrides savedPort
}

// Like req, but failures carry the server's own explanation.
async function send<T>(url: string, init: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new Error(body?.error || `HTTP ${res.status}`);
  return body as T;
}

export const api = {
  load: () => req<{ rev: number; store: Project | null }>('/api/store'),
  rev: () => req<{ rev: number }>('/api/rev'),
  save: (store: Project) =>
    req<{ rev: number }>('/api/store', { ...post({ store }), method: 'PUT' }),
  variables: (refs: string[]) =>
    req<{ values: Values; connections: Record<string, 'ok' | 'error' | 'unconfigured'> }>('/api/variables', post({ refs })),
  press: (connection: number, location: string) =>
    req<{ ok: boolean }>('/api/press', post({ connection, location, action: 'press' })),
  output: () => req<{ screenId: string | null }>('/api/output'),
  outputs: () =>
    req<{ mainPort: number; outputs: { port: number; screenId: string; state: 'starting' | 'ok' | 'error'; error: string }[] }>('/api/outputs'),
  testConnection: (connection: number) =>
    req<{ ok: boolean; sample?: string; error?: string }>(`/api/connection-test?connection=${connection}`),
  appInfo: () => req<AppInfo>('/api/app-info'),
  setAppPort: (port: number) => send<{ savedPort: number }>('/api/app-port', { ...post({ port }), method: 'PUT' }),
  restartApp: () => send<{ ok: boolean }>('/api/app-restart', post({})),
  uploadAsset: async (file: File) => {
    const res = await fetch('/api/assets', { method: 'POST', headers: { 'Content-Type': file.type }, body: file });
    if (!res.ok) throw new Error((await res.json().catch(() => null))?.error || `Upload failed (${res.status})`);
    return (await res.json()) as { url: string };
  },
};
