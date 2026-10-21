// Lets the web app ask the kiosk shell to wipe the session partition at sign-out, and drive web tools
// (read in frontend/lib/kiosk.ts).
const { contextBridge, ipcRenderer } = require('electron');

const kiosk = process.argv.includes('--albok-kiosk=true');

function subscribe(channel, callback) {
  const listener = (_event, detail) => callback(detail);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

contextBridge.exposeInMainWorld('albokKiosk', {
  kiosk,
  // This shell can show web tools; an older installer lacks the flag, so the web app shows none (R17).
  webTools: true,
  signOut: () => ipcRenderer.invoke('kiosk:sign-out'),
  setWebTools: (urls, endsInMs) => ipcRenderer.invoke('kiosk:set-web-tools', { urls, endsInMs }),
  onWebToolBlocked: (callback) => subscribe('kiosk:web-tool-blocked', callback),
  onWebToolActivity: (callback) => subscribe('kiosk:web-tool-activity', callback),
});
