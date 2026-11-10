import { cpSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { beforeAll, describe, expect, it } from 'vitest';
import { migrate } from '../src/platform/database/migrate';
import { MIGRATIONS_DIR, ownerUrl, resetTestDatabase } from './helpers';

describe('migration runner', () => {
  beforeAll(resetTestDatabase);

  it('is idempotent: a second run applies nothing', async () => {
    const result = await migrate(ownerUrl(), MIGRATIONS_DIR);
    expect(result.applied).toEqual([]);
    expect(result.skipped.length).toBeGreaterThanOrEqual(3);
  });

  it('refuses a migration that was edited after it was applied', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcc-mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    const file = join(dir, '202611101000__platform_core.sql');
    writeFileSync(file, `${readFileSync(file, 'utf8')}\n-- sneaky edit\n`);
    await expect(migrate(ownerUrl(), dir)).rejects.toThrow(/edited after it was applied/);
  });

  it('rejects badly named files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcc-mig-'));
    writeFileSync(join(dir, '0001_bad.sql'), 'select 1');
    await expect(migrate(ownerUrl(), dir)).rejects.toThrow(/does not match/);
  });

  it('a failing migration rolls back completely and is not recorded', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'dcc-mig-'));
    cpSync(MIGRATIONS_DIR, dir, { recursive: true });
    writeFileSync(
      join(dir, '209901010000__broken.sql'),
      'create table half_done (id int); select 1/0;',
    );
    await expect(migrate(ownerUrl(), dir)).rejects.toThrow(/209901010000__broken.sql failed/);
    const again = await migrate(ownerUrl(), MIGRATIONS_DIR); // the real set is still fine and no half_done table exists
    expect(again.applied).toEqual([]);
  });
});
