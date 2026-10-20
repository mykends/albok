// Albok desktop shell: starts the Python API, serves the exported Expo web app and opens the window.
const { app, BrowserWindow, dialog, net, protocol, shell } = require('electron');
const { spawn } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const ROOT = path.resolve(__dirname, '..');
const API_PORT = Number(process.env.ALBOK_PORT || 8765);
const API_URL = `http://127.0.0.1:${API_PORT}`;
// `npm run desktop:dev` points the window at the Expo dev server for hot reload.
const DEV_SERVER_URL = process.env.ALBOK_DEV_SERVER_URL;
const WEB_DIR = app.isPackaged ? path.join(process.resourcesPath, 'web') : path.join(ROOT, 'frontend', 'dist');
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  `connect-src 'self' ${API_URL}`,
  "script-src 'self'",
  // react-native-web injects its styles at runtime
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob:",
  "font-src 'self' data:",
].join('; ');

// Must match the origin the backend allows in CORS (see backend/albok_api/config.py).
protocol.registerSchemesAsPrivileged([
  { scheme: 'app', privileges: { standard: true, secure: true, supportFetchAPI: true } },
]);

let backendProcess = null;
let mainWindow = null;

function backendCommand() {
  if (app.isPackaged) {
    const exe = path.join(process.resourcesPath, 'backend', process.platform === 'win32' ? 'albok-backend.exe' : 'albok-backend');
    // Packaged builds keep the database in %APPDATA%\Albok\data.
    return { command: exe, args: [], cwd: path.dirname(exe), dataDir: path.join(app.getPath('userData'), 'data') };
  }
  const python =
    process.platform === 'win32'
      ? path.join(ROOT, 'backend', '.venv', 'Scripts', 'python.exe')
      : path.join(ROOT, 'backend', '.venv', 'bin', 'python');
  return { command: python, args: ['run.py'], cwd: path.join(ROOT, 'backend'), dataDir: undefined };
}

async function backendIsUp() {
  try {
    const response = await fetch(`${API_URL}/api/health`);
    return response.ok;
  } catch {
    return false;
  }
}

async function startBackend() {
  // Reuse a backend that is already running (e.g. started with `npm run backend`).
  if (await backendIsUp()) return;

  const { command, args, cwd, dataDir } = backendCommand();
  if (!fs.existsSync(command)) {
    throw new Error(`Backend not found at ${command}.\nRun "npm run setup" (development) or rebuild the app.`);
  }
  const env = { ...process.env, ALBOK_PORT: String(API_PORT), ALBOK_EXIT_WITH_PARENT: '1' };
  if (dataDir) env.ALBOK_DATA_DIR = dataDir;

  // stdin stays an open pipe so the backend can exit if this process dies without cleanup.
  backendProcess = spawn(command, args, { cwd, env, stdio: ['pipe', 'inherit', 'inherit'], windowsHide: true });
  backendProcess.on('exit', (code) => {
    backendProcess = null;
    if (code && !app.isQuitting) console.error(`Albok backend exited with code ${code}`);
  });

  for (let attempt = 0; attempt < 150; attempt++) {
    if (await backendIsUp()) return;
    if (!backendProcess) break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  throw new Error('The Albok backend did not start. Check that port ' + API_PORT + ' is free.');
}

function serveWebApp() {
  protocol.handle('app', async (request) => {
    const { pathname } = new URL(request.url);
    const filePath = path.join(WEB_DIR, decodeURIComponent(pathname));
    const relative = path.relative(WEB_DIR, filePath);
    if (relative.startsWith('..') || path.isAbsolute(relative)) {
      return new Response('Forbidden', { status: 403 });
    }
    const isFile = fs.existsSync(filePath) && fs.statSync(filePath).isFile();
    // Client-side routes (e.g. /subjects/1) fall back to the single-page app entry.
    const response = await net.fetch(pathToFileURL(isFile ? filePath : path.join(WEB_DIR, 'index.html')).toString());
    const headers = new Headers(response.headers);
    headers.set('Content-Security-Policy', CONTENT_SECURITY_POLICY);
    return new Response(response.body, { status: response.status, headers });
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 800,
    minHeight: 560,
    title: 'Albok',
    autoHideMenuBar: true,
    backgroundColor: '#ffffff',
    show: !process.env.ALBOK_SMOKE_SCREENSHOT,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      additionalArguments: [`--albok-api-url=${API_URL}`],
    },
  });

  // Open external links in the default browser instead of inside the app.
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });

  mainWindow.loadURL(DEV_SERVER_URL || 'app://albok/');
  return mainWindow;
}

if (!app.requestSingleInstanceLock()) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow?.isMinimized()) mainWindow.restore();
    mainWindow?.focus();
  });

  app.whenReady().then(async () => {
    try {
      await startBackend();
    } catch (error) {
      dialog.showErrorBox('Albok could not start', error.message);
      app.quit();
      return;
    }
    if (!DEV_SERVER_URL) serveWebApp();
    createWindow();

    // Smoke test used during development: render hidden, save a screenshot, quit.
    if (process.env.ALBOK_SMOKE_SCREENSHOT) {
      mainWindow.webContents.on('console-message', (event) => console.log('[renderer]', event.message));
      mainWindow.webContents.once('did-finish-load', () => {
        setTimeout(async () => {
          const image = await mainWindow.webContents.capturePage();
          fs.writeFileSync(process.env.ALBOK_SMOKE_SCREENSHOT, image.toPNG());
          app.quit();
        }, 3000);
      });
    }
  });

  app.on('before-quit', () => {
    app.isQuitting = true;
    backendProcess?.kill();
  });

  app.on('window-all-closed', () => app.quit());
}
