// Exposes the backend URL to the web app (read in frontend/lib/api.ts).
const { contextBridge } = require('electron');

const apiArg = process.argv.find((arg) => arg.startsWith('--albok-api-url='));

contextBridge.exposeInMainWorld('albok', {
  apiUrl: apiArg ? apiArg.slice('--albok-api-url='.length) : 'http://127.0.0.1:8765',
  platform: process.platform,
});
