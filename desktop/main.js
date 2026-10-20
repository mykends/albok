// Albok kiosk shell: a locked-down window onto https://albok.<school>.hr. The UI and all data live on the
// server; this app only shows it. Windows Assigned Access (set up by IT) does the OS-level lockdown.
//
// Configuration, first match wins:
//   1. command line:  --albok-url=https://albok.skola.hr [--kiosk=false]
//   2. environment:   ALBOK_URL, ALBOK_KIOSK, ALBOK_AUTH_ORIGINS (comma-separated)
//   3. config file:   %ProgramData%\Albok\config.json  {"url": "...", "kiosk": true, "authOrigins": [...]}
const { app, BrowserWindow, dialog, ipcMain, session } = require('electron');
const fs = require('node:fs');
const path = require('node:path');

// Sign-in pages of AAI@EduHr. The login flow leaves the Albok origin, so these are allowed too.
const DEFAULT_AUTH_ORIGINS = ['https://login.aaiedu.hr'];
// No "persist:" prefix: cookies and storage live in memory only and vanish when the app exits.
const PARTITION = 'albok-kiosk';
const RETRY_MS = 10_000;

function readConfig() {
  const arg = (name) => process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');
  let file = {};
  const programData = process.env.ProgramData || process.env.PROGRAMDATA;
  const candidates = [programData && path.join(programData, 'Albok', 'config.json'), path.join(app.getPath('userData'), 'config.json')];
  for (const candidate of candidates.filter(Boolean)) {
    try {
      file = JSON.parse(fs.readFileSync(candidate, 'utf8'));
      break;
    } catch {
      // missing or unreadable: try the next one
    }
  }
  const url = arg('albok-url') || process.env.ALBOK_URL || file.url;
  const kioskSetting = arg('kiosk') ?? process.env.ALBOK_KIOSK ?? file.kiosk;
  return {
    url: url ? url.replace(/\/$/, '') : null,
    kiosk: kioskSetting === undefined ? true : String(kioskSetting) !== 'false',
    authOrigins: [
      ...(file.authOrigins || DEFAULT_AUTH_ORIGINS),
      ...(process.env.ALBOK_AUTH_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean),
    ],
  };
}

const config = readConfig();
let mainWindow = null;
let quitting = false;

function isAllowed(target) {
  try {
    const { origin } = new URL(target);
    return origin === new URL(config.url).origin || config.authOrigins.includes(origin);
  } catch {
    return target.startsWith('data:text/html');
  }
}

function offlinePage() {
  const html = `<!doctype html><html lang="hr"><meta charset="utf-8"><title>Albok</title>
<style>body{font-family:system-ui;display:flex;height:100vh;margin:0;align-items:center;justify-content:center;background:#fafafa;color:#111}
div{text-align:center;max-width:420px}p{color:#666}</style>
<div><h2>Albok trenutačno nije dostupan</h2><p>Provjerite mrežnu vezu. Pokušavamo ponovno svakih nekoliko sekundi…</p></div>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

async function wipeSession() {
  const kioskSession = session.fromPartition(PARTITION);
  await kioskSession.clearStorageData();
  await kioskSession.clearCache();
  await kioskSession.clearAuthCache();
}

function lockDown(kioskSession) {
  // Students must not save, print or download material.
  kioskSession.on('will-download', (event) => event.preventDefault());
  kioskSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  kioskSession.setPermissionCheckHandler(() => false);
}

function createWindow() {
  const kioskSession = session.fromPartition(PARTITION);
  lockDown(kioskSession);

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Albok',
    kiosk: config.kiosk,
    fullscreen: config.kiosk,
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    webPreferences: {
      partition: PARTITION,
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--albok-kiosk=${config.kiosk}`],
      devTools: !config.kiosk,
      spellcheck: false,
    },
  });
  mainWindow.removeMenu();

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(() => ({ action: 'deny' }));
  const guard = (event, target) => {
    if (!isAllowed(target)) event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', (event) => event.preventDefault());

  // No printing, dev tools, closing or zoom-out-of-kiosk shortcuts.
  contents.on('before-input-event', (event, input) => {
    const key = input.key.toLowerCase();
    const ctrl = input.control || input.meta;
    if (ctrl && ['p', 's', 'o', 'n', 't', 'w', 'q', 'j', 'u'].includes(key)) event.preventDefault();
    if (config.kiosk && (key === 'f12' || (ctrl && input.shift && ['i', 'j', 'c'].includes(key)))) event.preventDefault();
    if (config.kiosk && input.alt && key === 'f4') event.preventDefault();
  });
  contents.on('dom-ready', () => {
    contents.executeJavaScript('window.print = () => {};').catch(() => {});
  });

  // Network or server trouble: show a friendly page and keep retrying.
  contents.on('did-fail-load', (_event, code, _description, url, isMainFrame) => {
    if (!isMainFrame || code === -3 /* aborted, e.g. by our navigation guard */ || url.startsWith('data:')) return;
    contents.loadURL(offlinePage());
    setTimeout(() => contents.loadURL(`${config.url}/login`), RETRY_MS);
  });
  contents.on('render-process-gone', () => contents.loadURL(`${config.url}/login`));

  mainWindow.on('close', (event) => {
    // Students can't quit the kiosk; IT can still end the process.
    if (config.kiosk && !quitting) event.preventDefault();
  });

  contents.loadURL(`${config.url}/login`);
}

// The web app calls this (through preload.js) at every sign-out, after flushing notes.
ipcMain.handle('kiosk:sign-out', async () => {
  await wipeSession();
});

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    if (!config.url) {
      dialog.showErrorBox(
        'Albok nije podešen',
        'Nedostaje adresa poslužitelja. Upišite je u %ProgramData%\\Albok\\config.json, npr. {"url": "https://albok.skola.hr"}.'
      );
      app.exit(1);
      return;
    }
    // Start every run with a clean session, even after a crash.
    await wipeSession();
    createWindow();
  });

  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => app.quit());
}
