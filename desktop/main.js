// Albok kiosk shell: a locked-down window onto https://albok.<school>.hr. The UI and all data live on the
// server; this app only shows it. Windows Assigned Access (set up by IT) does the OS-level lockdown.
// The only other sites it shows are the web tools a professor opened for the student's lesson, each in a
// hardened <webview> locked to that tool's site (docs/adr/0001-web-tools-in-the-kiosk.md).
//
// Configuration, first match wins:
//   1. command line:  --albok-url=https://albok.skola.hr [--kiosk=false]
//   2. environment:   ALBOK_URL, ALBOK_KIOSK, ALBOK_AUTH_ORIGINS (comma-separated)
//   3. config file:   %ProgramData%\Albok\config.json  {"url": "...", "kiosk": true, "authOrigins": [...]}
const { app, BrowserWindow, dialog, ipcMain, session, shell } = require('electron');
const fs = require('node:fs');
const path = require('node:path');
const { createOpenTools, isSameSite } = require('./web-tools');

// Sign-in pages of AAI@EduHr. The login flow leaves the Albok origin, so these are allowed too.
const DEFAULT_AUTH_ORIGINS = ['https://login.aaiedu.hr'];
// No "persist:" prefix: cookies and storage live in memory only and vanish when the app exits.
const PARTITION = 'albok-kiosk';
// Web tools get a session of their own, also in memory only and wiped at every sign-out.
const WEB_TOOLS_PARTITION = 'albok-webtools';
const RETRY_MS = 10_000;
// Input inside a web tool goes to the tool, not the Albok page; the page hears about it at most this often.
const ACTIVITY_THROTTLE_MS = 1000;
// The input the page's idle timer counts as activity (see frontend/components/session-watch.tsx).
const ACTIVITY_INPUT = new Set(['mouseDown', 'rawKeyDown', 'keyDown', 'mouseWheel', 'touchStart', 'gestureScrollUpdate']);

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

// Tool webviews by webContents id, with the open tool each was attached for.
const guests = new Map();
// Set by will-attach-webview and taken by web-contents-created; Electron runs both in the same tick.
let attachingTool = null;
const openTools = createOpenTools({ onChange: closeRemovedTools });

// The page removes the tab too; this makes sure a closed tool stops showing even if it doesn't.
function closeRemovedTools(urls) {
  for (const { contents, tool } of guests.values()) {
    if (!urls.includes(tool) && !contents.isDestroyed()) {
      contents.stop();
      contents.loadURL('about:blank').catch(() => {});
    }
  }
}

// The preload bridge reaches every page in the main window, including the sign-in origin; only the
// Albok page may manage or embed web tools.
function isAlbokPage(url) {
  try {
    return new URL(url).origin === new URL(config.url).origin;
  } catch {
    return false;
  }
}

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
  for (const partition of [PARTITION, WEB_TOOLS_PARTITION]) {
    const partitionSession = session.fromPartition(partition);
    await partitionSession.clearStorageData();
    await partitionSession.clearCache();
    await partitionSession.clearAuthCache();
  }
}

function lockDown(kioskSession) {
  // Students must not save, print or download material.
  kioskSession.on('will-download', (event) => event.preventDefault());
  kioskSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  kioskSession.setPermissionCheckHandler(() => false);
}

// No printing, dev tools, closing or zoom-out-of-kiosk shortcuts.
function blockShortcuts(event, input) {
  const key = input.key.toLowerCase();
  const ctrl = input.control || input.meta;
  if (ctrl && ['p', 's', 'o', 'n', 't', 'w', 'q', 'j', 'u'].includes(key)) event.preventDefault();
  if (config.kiosk && (key === 'f12' || (ctrl && input.shift && ['i', 'j', 'c'].includes(key)))) event.preventDefault();
  if (config.kiosk && input.alt && key === 'f4') event.preventDefault();
}

function toolAllows(tool, target) {
  return tool !== null && openTools.allows(tool) && isSameSite(tool, target);
}

function lockDownWebTools() {
  const toolSession = session.fromPartition(WEB_TOOLS_PARTITION);
  lockDown(toolSession);
  // Backstop for top-level loads the navigation events below don't see, such as a src changed after attach.
  toolSession.webRequest.onBeforeRequest({ urls: ['*://*/*'], types: ['mainFrame'] }, (details, callback) => {
    if (details.resourceType !== 'mainFrame') return callback({});
    const guest = guests.get(details.webContentsId);
    callback({ cancel: !guest || !toolAllows(guest.tool, details.url) });
  });
}

// Only an open tool's exact link may attach, and only with these options.
function checkWebToolAttach(event, webPreferences, params) {
  if (!isAlbokPage(event.sender.getURL()) || !openTools.allows(params.src)) {
    event.preventDefault();
    return;
  }
  delete webPreferences.preload;
  delete webPreferences.preloadURL;
  Object.assign(webPreferences, {
    // Pop-ups must reach guardWebTool's window-open handler, which never opens a window; with them
    // disabled, Chromium drops target="_blank" links and "Sign in with Google" silently.
    disablePopups: false,
    nodeIntegration: false,
    nodeIntegrationInSubFrames: false,
    nodeIntegrationInWorker: false,
    contextIsolation: true,
    sandbox: true,
    webSecurity: true,
    allowRunningInsecureContent: false,
    webviewTag: false,
    partition: WEB_TOOLS_PARTITION,
    devTools: !config.kiosk,
    spellcheck: false,
  });
  params.partition = WEB_TOOLS_PARTITION;
  attachingTool = new URL(params.src).href;
}

// A tool stays on its own site: other sites, new windows and printing are refused, and the page is told
// so it can say "not allowed in this lesson".
function guardWebTool(guest, tool) {
  const id = guest.id;
  guests.set(id, { contents: guest, tool });
  guest.once('destroyed', () => guests.delete(id));
  const blocked = (url) => mainWindow?.webContents.send('kiosk:web-tool-blocked', { webContentsId: id, url });

  // A same-site target="_blank" link opens in the tool itself; anything else, such as "Sign in with
  // Google", gets the notice.
  guest.setWindowOpenHandler(({ url }) => {
    if (toolAllows(tool, url)) guest.loadURL(url).catch(() => {});
    else blocked(url);
    return { action: 'deny' };
  });
  // Only the top level is checked, so embedded frames and resources keep the tool working.
  const guard = (event) => {
    if (!event.isMainFrame || toolAllows(tool, event.url)) return;
    event.preventDefault();
    blocked(event.url);
  };
  guest.on('will-frame-navigate', guard);
  guest.on('will-redirect', guard);
  // A second guard for the main frame; will-frame-navigate above already reports it to the page.
  guest.on('will-navigate', (event) => {
    if (!toolAllows(tool, event.url)) event.preventDefault();
  });

  let lastActivity = 0;
  guest.on('before-input-event', blockShortcuts);
  // Working only inside a tool must still count as activity for the idle sign-out.
  guest.on('input-event', (_event, input) => {
    const now = Date.now();
    if (!ACTIVITY_INPUT.has(input.type) || now - lastActivity < ACTIVITY_THROTTLE_MS) return;
    lastActivity = now;
    mainWindow?.webContents.send('kiosk:web-tool-activity');
  });
  // Tool pages print from iframes and before dom-ready, so cover every frame on every load.
  const disablePrint = () => {
    if (guest.isDestroyed()) return;
    for (const frame of guest.mainFrame.framesInSubtree) frame.executeJavaScript('window.print = () => {};').catch(() => {});
  };
  guest.on('did-frame-navigate', disablePrint);
  guest.on('dom-ready', disablePrint);
  guest.on('did-frame-finish-load', disablePrint);
  if (config.kiosk) guest.on('devtools-opened', () => guest.closeDevTools());
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
      webviewTag: true,
    },
  });
  mainWindow.removeMenu();

  const contents = mainWindow.webContents;
  contents.setWindowOpenHandler(({ url }) => {
    // Outside kiosk mode (professors' own PCs) links meant for a new tab open in the system browser.
    if (!config.kiosk && url.startsWith('https://')) shell.openExternal(url);
    return { action: 'deny' };
  });
  const guard = (event, target) => {
    if (!isAllowed(target)) event.preventDefault();
  };
  contents.on('will-navigate', guard);
  contents.on('will-redirect', guard);
  contents.on('will-attach-webview', checkWebToolAttach);
  contents.on('before-input-event', blockShortcuts);
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
  openTools.clear();
  await wipeSession();
});

// The web app sends the lesson's open tools on every poll (an empty list when the poll fails).
ipcMain.handle('kiosk:set-web-tools', (event, payload) => {
  if (event.sender !== mainWindow?.webContents || !isAlbokPage(event.senderFrame?.url)) return;
  openTools.set(payload?.urls, payload?.endsInMs);
});

app.on('web-contents-created', (_event, contents) => {
  if (contents.getType() !== 'webview') return;
  // A webview that didn't come through checkWebToolAttach gets no site at all.
  const tool = attachingTool;
  attachingTool = null;
  guardWebTool(contents, tool);
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
    lockDownWebTools();
    createWindow();
  });

  app.on('before-quit', () => {
    quitting = true;
  });
  app.on('window-all-closed', () => app.quit());
}
