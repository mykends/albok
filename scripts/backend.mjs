// Runs backend tasks with the project's virtualenv Python, on Windows, macOS and Linux.
import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const backendDir = join(dirname(fileURLToPath(import.meta.url)), '..', 'backend');
const python =
  process.platform === 'win32'
    ? join(backendDir, '.venv', 'Scripts', 'python.exe')
    : join(backendDir, '.venv', 'bin', 'python');

const TASKS = {
  serve: ['run.py'],
  test: ['-m', 'pytest', '-q'],
  // One folder (not --onefile) so the desktop app can stop a single process cleanly.
  build: ['-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--name', 'albok-backend', '--collect-submodules', 'uvicorn', 'run.py'],
};

const task = process.argv[2] ?? 'serve';
if (!TASKS[task]) {
  console.error(`Unknown task "${task}". Use one of: ${Object.keys(TASKS).join(', ')}`);
  process.exit(1);
}
if (!existsSync(python)) {
  console.error('The Python environment is missing. Run "npm run setup" first.');
  process.exit(1);
}

const result = spawnSync(python, [...TASKS[task], ...process.argv.slice(3)], { cwd: backendDir, stdio: 'inherit' });
process.exit(result.status ?? 1);
