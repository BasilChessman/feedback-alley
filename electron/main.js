// Feedback Alley desktop app: runs the same server as `npm start` inside the
// app and shows the editor in a window. Displays on this or other machines
// open in a browser, so they keep running while the editor window is closed
// (macOS) and stop only when the app quits.

import { app, BrowserWindow, clipboard, dialog, Menu, shell } from 'electron';
import fs from 'node:fs';
import path from 'node:path';
import { lanUrls, rootDir, startServer } from '../server/app.js';

const DEFAULT_PORT = 8090;
const isMac = process.platform === 'darwin';

// Project data lives in the user's app-data folder, e.g.
// ~/Library/Application Support/Feedback Alley/data on macOS,
// %APPDATA%\Feedback Alley\data on Windows. DATA_DIR overrides it, as with `npm start`.
const dataDir = () => (process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(app.getPath('userData'), 'data'));
const prefsFile = () => path.join(app.getPath('userData'), 'app-settings.json');

function readPrefs() {
  try {
    return JSON.parse(fs.readFileSync(prefsFile(), 'utf8'));
  } catch {
    return {};
  }
}

let port = 0;
let win = null;
let quitting = false;

function createWindow() {
  win = new BrowserWindow({
    width: 1500,
    height: 950,
    minWidth: 900,
    minHeight: 600,
    title: 'Feedback Alley',
    backgroundColor: '#1b1f27',
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  win.loadURL(`http://localhost:${port}/`);
  // "Open display" and other links open in the regular browser, where a
  // display can go full screen on any monitor.
  win.webContents.setWindowOpenHandler(({ url }) => {
    shell.openExternal(url);
    return { action: 'deny' };
  });
  win.webContents.on('will-navigate', (e, url) => {
    if (!url.startsWith(`http://localhost:${port}/`)) {
      e.preventDefault();
      shell.openExternal(url);
    }
  });
  win.on('close', (e) => {
    if (isMac || quitting) return;
    // Elsewhere closing the window quits the app, which stops every display.
    const choice = dialog.showMessageBoxSync(win, {
      type: 'question',
      buttons: ['Quit', 'Cancel'],
      defaultId: 1,
      cancelId: 1,
      message: 'Quit Feedback Alley?',
      detail: 'Displays showing your screens will stop updating until Feedback Alley is opened again.',
    });
    if (choice === 1) e.preventDefault();
    else quitting = true;
  });
  win.on('closed', () => (win = null));
}

function buildMenu() {
  const urls = [`http://localhost:${port}/`, ...lanUrls(port)];
  const template = [
    ...(isMac ? [{ role: 'appMenu' }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'Open Editor in Browser', click: () => shell.openExternal(`http://localhost:${port}/`) },
        {
          label: 'Copy Network Address',
          submenu: urls.map((u) => ({ label: u, click: () => clipboard.writeText(u) })),
        },
        { type: 'separator' },
        { label: 'Show Data Folder', click: () => shell.openPath(dataDir()) },
        { type: 'separator' },
        isMac ? { role: 'close' } : { role: 'quit' },
      ],
    },
    { role: 'editMenu' },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
    { role: 'windowMenu' },
  ];
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (!win) createWindow();
    else {
      if (win.isMinimized()) win.restore();
      win.focus();
    }
  });

  app.whenReady().then(async () => {
    const wanted = Number(process.env.PORT || readPrefs().port || DEFAULT_PORT);
    try {
      fs.mkdirSync(dataDir(), { recursive: true });
      ({ port } = await startServer({
        port: wanted,
        dataDir: dataDir(),
        distDir: path.join(rootDir, 'dist'),
        fallback: 20,
      }));
    } catch (err) {
      dialog.showErrorBox('Feedback Alley could not start', String(err.message || err));
      app.quit();
      return;
    }
    if (port !== wanted) {
      dialog.showMessageBox({
        type: 'warning',
        message: `Port ${wanted} is in use`,
        detail: `Feedback Alley is running on port ${port} instead. Displays that use http://…:${wanted}/ need the new address.`,
      });
    }
    buildMenu();
    createWindow();
  });

  app.on('activate', () => {
    if (!win && port) createWindow();
  });
  app.on('before-quit', () => (quitting = true));
  app.on('window-all-closed', () => {
    if (!isMac) app.quit();
  });
}
