import { askText } from '../editor/askText';

// Save text to a file the user names and places. Uses the system Save dialog
// where the browser has one (Chrome, Edge and the desktop app); elsewhere
// (Safari, Firefox) it asks for a name and the browser's download setting
// decides the folder. Resolves with the file name, or null if cancelled.

type SavePicker = (opts: {
  suggestedName?: string;
  types?: { description: string; accept: Record<string, string[]> }[];
}) => Promise<{ name: string; createWritable: () => Promise<{ write: (data: string) => Promise<void>; close: () => Promise<void> }> }>;

export async function saveTextFile(suggestedName: string, text: string, description = 'JSON file'): Promise<string | null> {
  const picker = (window as unknown as { showSaveFilePicker?: SavePicker }).showSaveFilePicker;
  if (picker) {
    try {
      const handle = await picker({ suggestedName, types: [{ description, accept: { 'application/json': ['.json'] } }] });
      const out = await handle.createWritable();
      await out.write(text);
      await out.close();
      return handle.name;
    } catch (err) {
      if ((err as Error).name === 'AbortError') return null;
      // e.g. not allowed in this context: fall back to a download
    }
  }
  let name = await askText({ title: 'Export project', label: 'File name', value: suggestedName, okLabel: 'Save' });
  if (!name) return null;
  if (!/\.json$/i.test(name)) name += '.json';
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  return name;
}
