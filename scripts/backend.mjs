// Runs backend tasks with the project's virtualenv Python, on Windows, macOS and Linux.
// `serve` is for development: it signs in through the built-in mock AAI@EduHr provider and seeds demo data.
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
  serve: { args: ['run.py'], env: { ALBOK_MOCK_OIDC: '1' } },
  test: { args: ['-m', 'pytest', '-q'], env: {} },
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

const { args, env } = TASKS[task];
const result = spawnSync(python, [...args, ...process.argv.slice(3)], {
  cwd: backendDir,
  stdio: 'inherit',
  // Explicit environment variables win over the development defaults.
  env: { ...env, ...process.env },
});
process.exit(result.status ?? 1);
