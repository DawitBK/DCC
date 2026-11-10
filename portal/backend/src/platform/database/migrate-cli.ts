import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { migrate } from './migrate';

const root = resolve(__dirname, '..', '..', '..', '..', '..');
if (!process.env.DCC_ENV_FILE && existsSync(resolve(root, '.env')))
  process.loadEnvFile(resolve(root, '.env'));

const url = process.env.DCC_MIGRATE_DATABASE_URL;
if (!url) {
  console.error(
    'Missing DCC_MIGRATE_DATABASE_URL (the dcc_owner role). Copy .env.example to .env.',
  );
  process.exit(1);
}

migrate(url, resolve(__dirname, '..', '..', '..', 'migrations'), (m) => console.log(m))
  .then((r) =>
    console.log(`migrations: ${r.applied.length} applied, ${r.skipped.length} already up to date`),
  )
  .catch((e) => {
    console.error(e.message);
    process.exit(1);
  });
