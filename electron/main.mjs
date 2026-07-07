// Electron wrapper: hosts the existing Express app in-process and shows it in a
// desktop window. No code duplication — it imports ../server.js as-is.
import { app as electronApp, BrowserWindow, shell, dialog } from 'electron';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

// The packaged app bundle is read-only, so the SQLite DB must live in a writable
// per-user location (~/Library/Application Support/Personal Budget on macOS).
const dataDir = join(electronApp.getPath('userData'), 'data');
mkdirSync(dataDir, { recursive: true });
process.env.BUDGET_DATA_DIR = dataDir;

// Start the Express app on an OS-assigned free port (avoids clashing with a
// dev server or a second copy of the app).
async function startServer() {
  const { app: expressApp } = await import('../server.js');
  return new Promise((resolve, reject) => {
    const server = expressApp.listen(0, '127.0.0.1', () => {
      resolve(`http://127.0.0.1:${server.address().port}`);
    });
    server.on('error', reject);
  });
}

function createWindow(url) {
  const win = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 900,
    minHeight: 600,
    title: 'Personal Budget',
    backgroundColor: '#0e0e12',
    webPreferences: { contextIsolation: true, nodeIntegration: false },
  });
  win.loadURL(url);
  // Any external link opens in the system browser, never inside the app shell.
  win.webContents.setWindowOpenHandler(({ url: target }) => {
    shell.openExternal(target);
    return { action: 'deny' };
  });
  return win;
}

electronApp.whenReady().then(async () => {
  const url = await startServer();
  createWindow(url);
  // macOS: re-open a window when the dock icon is clicked and none are open.
  electronApp.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow(url);
  });
}).catch((err) => {
  // Surface a startup failure (e.g. unwritable data dir, corrupt DB) instead of
  // hanging with no window and no feedback.
  dialog.showErrorBox('Personal Budget could not start', String(err?.stack || err));
  electronApp.quit();
});

// Quit when all windows close, except on macOS where apps stay in the dock.
electronApp.on('window-all-closed', () => {
  if (process.platform !== 'darwin') electronApp.quit();
});
