// Runs a command with one environment file loaded, e.g. the mirror:
//   node scripts/run-with-env.mjs .env.mirror node apps/api/dist/main.js
// Why: npm scripts cannot set variables portably on Windows. While DCC_ENV_FILE is set, the other loaders
// skip the default `.env`, so a mirror run never silently picks up a missing value from the dev file.
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const [file, command, ...args] = process.argv.slice(2);
if (!file || !command) {
  console.error('Usage: run-with-env.mjs <envFile> <command> [args...]');
  process.exit(1);
}
const root = resolve(import.meta.dirname, '..');
const path = resolve(root, file);
if (!existsSync(path)) {
  console.error(`No such environment file: ${path}`);
  process.exit(1);
}
process.loadEnvFile(path);
const child = spawn(command, args, {
  stdio: 'inherit',
  windowsHide: true,
  shell: process.platform === 'win32' && command !== process.execPath && command !== 'node',
  env: { ...process.env, DCC_ENV_FILE: path },
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
