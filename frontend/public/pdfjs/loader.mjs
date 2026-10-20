// Loaded by app/+html.tsx. Exposes pdf.js as window.pdfjsLib (kept out of the Metro bundle).
import * as pdfjsLib from './pdf.min.mjs';

pdfjsLib.GlobalWorkerOptions.workerSrc = '/pdfjs/pdf.worker.min.mjs';
window.pdfjsLib = pdfjsLib;
window.dispatchEvent(new Event('albok-pdfjs-ready'));
