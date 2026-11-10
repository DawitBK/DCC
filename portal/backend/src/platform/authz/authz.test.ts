import { describe, expect, it } from 'vitest';
import {
  assertDifferentPeople,
  can,
  canAnywhere,
  permissionsOf,
  scopesWith,
  SeparationOfDutiesError,
  type Membership,
} from './authz';

const G1 = 'g1';
const A = 'company-a';
const B = 'company-b';
const m = (role: Membership['role'], companyId: string | null, groupId = G1): Membership => ({
  role,
  companyId,
  groupId,
});

describe('authorization', () => {
  it('a company-level role applies only to that company', () => {
    const access = { memberships: [m('company_admin', A)] };
    expect(can(access, 'brand.manage', { groupId: G1, companyId: A })).toBe(true);
    expect(can(access, 'brand.manage', { groupId: G1, companyId: B })).toBe(false);
    expect(can(access, 'brand.manage', { groupId: G1 })).toBe(false);
  });

  it('a group-level role applies to every company of its own group only', () => {
    const access = { memberships: [m('group_admin', null)] };
    expect(can(access, 'company.manage', { groupId: G1 })).toBe(true);
    expect(can(access, 'brand.manage', { groupId: G1, companyId: B })).toBe(true);
    expect(can(access, 'brand.manage', { groupId: 'g2', companyId: 'other' })).toBe(false);
  });

  it('holding a permission in one company never grants it in another (roles do not blend)', () => {
    const access = { memberships: [m('company_admin', A), m('content_creator', B)] };
    expect(can(access, 'brand.manage', { groupId: G1, companyId: A })).toBe(true);
    expect(can(access, 'brand.manage', { groupId: G1, companyId: B })).toBe(false);
    expect(can(access, 'content.create', { groupId: G1, companyId: B })).toBe(true);
    expect(can(access, 'content.create', { groupId: G1, companyId: A })).toBe(false);
  });

  it('no memberships means no permissions', () => {
    expect(canAnywhere({ memberships: [] }, 'company.read')).toBe(false);
    expect(permissionsOf({ memberships: [] })).toEqual([]);
  });

  it('scopesWith lists where a permission is held', () => {
    const access = {
      memberships: [m('group_cto', null), m('company_admin', A), m('content_creator', B)],
    };
    expect(scopesWith(access, 'security.read')).toEqual({ groupIds: [G1], companyIds: [] });
    expect(scopesWith(access, 'brand.manage')).toEqual({ groupIds: [], companyIds: [A] });
    expect(scopesWith(access, 'content.create')).toEqual({ groupIds: [], companyIds: [B] });
  });

  it('separation of duties: the creator cannot approve their own content', () => {
    expect(() => assertDifferentPeople('u1', 'u1')).toThrow(SeparationOfDutiesError);
    expect(() => assertDifferentPeople('u1', 'u2')).not.toThrow();
  });
});
