import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { addKeyToFile, readKeyRing } from './secrets';

/**
 * Creates the DCC key file, or rotates it (ADR-0007; docs/devops/SECRETS-AND-KEYS.md).
 *   npm run secrets:keygen -- <absolute path of the key file>
 * First run: creates the file with one key. Later runs: add a new key and make it the active one;
 * the old keys stay so data encrypted earlier still opens. It prints key ids only, never a key.
 */
const target = process.argv[2];
if (!target) {
  console.error('Usage: npm run secrets:keygen -- <absolute path of the key file>');
  process.exit(2);
}
try {
  const path = resolve(target);
  const existed = existsSync(path);
  const id = addKeyToFile(path);
  const ring = readKeyRing(path);
  console.log(
    existed
      ? `Added key "${id}" and made it active. Keys now in the file: ${Object.keys(ring.keys).join(', ')}.`
      : `Created ${path} with key "${id}".`,
  );
  console.log('Next:');
  console.log(
    '  1. Restrict the file to the account DCC runs as (Windows: icacls; Linux: chmod 600).',
  );
  console.log(
    `  2. In the server environment file: SECRETS_PROVIDER=key-file and DCC_KEY_FILE=${path}`,
  );
  console.log(
    '  3. Restart the DCC backend. Keep a copy of the file where the owner keeps secrets.',
  );
} catch (e) {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
}
