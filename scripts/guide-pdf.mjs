// Prints the user guide (dist/guide/index.html) to release/Feedback-Alley-User-Guide.pdf
// using Electron's built-in Chromium. Run after `npm run build`: `npm run guide:pdf`.

import { app, BrowserWindow } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const root = path.resolve(import.meta.dirname, '..');
const src = path.join(root, 'dist', 'guide', 'index.html');
const out = path.join(root, 'release', 'Feedback-Alley-User-Guide.pdf');

app.whenReady().then(async () => {
  try {
    if (!fs.existsSync(src)) throw new Error(`${src} is missing; run npm run build first`);
    const win = new BrowserWindow({ show: false, width: 1200, height: 900 });
    await win.loadURL(pathToFileURL(src).href);
    // make sure every screenshot has loaded before printing
    await win.webContents.executeJavaScript(
      'Promise.all([...document.images].map((i) => i.complete ? 0 : new Promise((r) => (i.onload = i.onerror = r))))',
    );
    const pdf = await win.webContents.printToPDF({ pageSize: 'Letter', printBackground: true, generateDocumentOutline: true });
    fs.mkdirSync(path.dirname(out), { recursive: true });
    fs.writeFileSync(out, pdf);
    console.log(`Wrote ${path.relative(root, out)} (${Math.round(pdf.length / 1024)} KB)`);
    app.exit(0);
  } catch (err) {
    console.error(err.message || err);
    app.exit(1);
  }
});
