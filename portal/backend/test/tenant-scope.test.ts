import { describe, expect, it } from 'vitest';
import { NIL, SYSTEM_USER_ID, systemCheckContext } from '../src/modules/shared/tenant-scope';

describe('tenant scope helpers', () => {
  it('builds a company-scoped system-check context', () => {
    expect(systemCheckContext('company-a')).toEqual({
      userId: SYSTEM_USER_ID,
      groupIds: [],
      companyIds: ['company-a'],
    });
    expect(NIL).toBe(SYSTEM_USER_ID);
  });
});
