// Starts Next.js on the port from the repo-root .env (DCC_WEB_PORT, default 7717).
// Why a launcher: npm scripts cannot read a .env file or a default value portably on Windows, and on
// some Windows machines the registered port is inside a reserved range (see docs/devops/WINDOWS-PORTS.md).
// Usage: node scripts/run-next.mjs dev|start
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const rootEnv = resolve(appDir, '..', '..', '.env');
if (!process.env.DCC_ENV_FILE && existsSync(rootEnv)) process.loadEnvFile(rootEnv);

const mode = process.argv[2];
if (mode !== 'dev' && mode !== 'start') {
  console.error('Usage: run-next.mjs dev|start');
  process.exit(1);
}
const port = process.env.DCC_WEB_PORT ?? '7717';
const nextBin = resolve(appDir, '..', '..', 'node_modules', 'next', 'dist', 'bin', 'next');

// Next decides dev/production from its command; the .env's NODE_ENV (meant for the API) must not leak in.
const env = { ...process.env, NODE_ENV: mode === 'dev' ? 'development' : 'production' };
const child = spawn(process.execPath, [nextBin, mode, '--port', port], {
  cwd: appDir,
  stdio: 'inherit',
  windowsHide: true,
  env,
});
child.on('exit', (code) => process.exit(code ?? 0));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
