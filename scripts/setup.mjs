// One-time setup: Python virtualenv + backend packages, then npm packages for the frontend and desktop shell.
import { spawnSync } from 'node:child_process';
import { existsSync, rmSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const backendDir = join(root, 'backend');
const venvDir = join(backendDir, '.venv');
const isWindows = process.platform === 'win32';
const venvPython = isWindows ? join(venvDir, 'Scripts', 'python.exe') : join(venvDir, 'bin', 'python');

function run(command, args, cwd, { shell = false } = {}) {
  console.log(`\n> ${command} ${args.join(' ')}   (in ${relative(root, cwd) || '.'})`);
  const result = spawnSync(command, args, { cwd, stdio: 'inherit', shell });
  return result.status === 0;
}

function must(ok, message) {
  if (!ok) {
    console.error(`\n✖ ${message}`);
    process.exit(1);
  }
}

function createVenv() {
  const pythons = isWindows ? [['py', ['-3']], ['python', []]] : [['python3', []], ['python', []]];
  for (const [command, prefix] of pythons) {
    // Plain `venv` first; fall back to `virtualenv` (e.g. Ubuntu without python3-venv).
    for (const module of ['venv', 'virtualenv']) {
      if (run(command, [...prefix, '-m', module, '.venv'], backendDir) && existsSync(venvPython)) return true;
      rmSync(venvDir, { recursive: true, force: true });
    }
  }
  return false;
}

if (!existsSync(venvPython)) {
  must(createVenv(), 'Could not create a Python virtual environment. Install Python 3.11 or newer and try again.');
}
must(run(venvPython, ['-m', 'pip', 'install', '-r', 'requirements-dev.txt'], backendDir), 'Installing Python packages failed.');

for (const dir of ['frontend', 'desktop']) {
  must(run('npm', ['install'], join(root, dir), { shell: isWindows }), `npm install failed in ${dir}/.`);
}

console.log('\n✔ Setup complete.');
console.log('  npm run dev           → API (mock AAI@EduHr login, demo data) + app in your browser');
console.log('  npm run desktop:dev   → the same, inside the kiosk shell (windowed)');
