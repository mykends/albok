// Copies pdf.js into public/ so the web app (and the kiosk, which only allows the Albok origin) loads it
// from the same origin. Runs after `npm install`.
//   build:          the library and its worker
//   wasm:           JBIG2 / JPEG 2000 decoders (common in scanned books) and colour profiles
//   standard_fonts, cmaps, iccs: data for PDFs that don't embed everything
import { cpSync, mkdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const source = join(root, 'node_modules', 'pdfjs-dist');
const target = join(root, 'public', 'pdfjs');
mkdirSync(target, { recursive: true });
for (const file of ['pdf.min.mjs', 'pdf.worker.min.mjs']) cpSync(join(source, 'build', file), join(target, file));
for (const dir of ['standard_fonts', 'cmaps', 'iccs']) {
  rmSync(join(target, dir), { recursive: true, force: true });
  cpSync(join(source, dir), join(target, dir), { recursive: true });
}
rmSync(join(target, 'wasm'), { recursive: true, force: true });
// quickjs-eval is only for PDF scripting, which Albok never runs.
cpSync(join(source, 'wasm'), join(target, 'wasm'), { recursive: true, filter: (path) => !path.includes('quickjs') });
console.log('Copied pdf.js to public/pdfjs');
