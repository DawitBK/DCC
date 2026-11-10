import { describe, expect, it } from 'vitest';
import { PERMISSIONS, ROLE_PERMISSIONS, roleHasPermission } from './permissions';
import { ROLES, roleAllowedAtScope } from './roles';

describe('role -> permission table', () => {
  it('defines every role and only known permissions', () => {
    for (const role of ROLES) {
      expect(ROLE_PERMISSIONS[role], role).toBeDefined();
      for (const p of ROLE_PERMISSIONS[role]) expect(PERMISSIONS).toContain(p);
    }
  });

  // Proposal 7.3: oversight, security and audit roles never publish.
  it.each([
    'group_admin',
    'group_cto',
    'security_admin',
    'group_marketing',
    'auditor',
    'company_admin',
  ] as const)('%s cannot publish', (role) =>
    expect(roleHasPermission(role, 'content.publish')).toBe(false),
  );

  // Separation of duties: nobody gets create + approve + publish together except by holding several roles.
  it('only the marketing manager combines create, approve and publish (by design, with the approval-policy check in the API)', () => {
    const all = ROLES.filter(
      (r) =>
        roleHasPermission(r, 'content.create') &&
        roleHasPermission(r, 'content.approve') &&
        roleHasPermission(r, 'content.publish'),
    );
    expect(all).toEqual(['company_marketing_manager']);
  });

  it('the publisher cannot approve and the creator cannot approve or publish', () => {
    expect(roleHasPermission('publisher', 'content.approve')).toBe(false);
    expect(roleHasPermission('content_creator', 'content.approve')).toBe(false);
    expect(roleHasPermission('content_creator', 'content.publish')).toBe(false);
  });

  it('the auditor is read-only', () => {
    const writes = ROLE_PERMISSIONS.auditor.filter((p) =>
      /\.(manage|create|submit|approve|publish|review|freeze)$/.test(p),
    );
    expect(writes).toEqual([]);
  });

  it('role scopes: group-only, company-only and either', () => {
    expect(roleAllowedAtScope('group_admin', 'group')).toBe(true);
    expect(roleAllowedAtScope('group_admin', 'company')).toBe(false);
    expect(roleAllowedAtScope('publisher', 'company')).toBe(true);
    expect(roleAllowedAtScope('publisher', 'group')).toBe(false);
    expect(roleAllowedAtScope('auditor', 'group')).toBe(true);
    expect(roleAllowedAtScope('auditor', 'company')).toBe(true);
  });
});
