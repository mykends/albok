// Lets the web app ask the kiosk shell to wipe the session partition at sign-out
// (read in frontend/stores/session-store.ts).
const { contextBridge, ipcRenderer } = require('electron');

const kiosk = process.argv.includes('--albok-kiosk=true');

contextBridge.exposeInMainWorld('albokKiosk', {
  kiosk,
  signOut: () => ipcRenderer.invoke('kiosk:sign-out'),
});
