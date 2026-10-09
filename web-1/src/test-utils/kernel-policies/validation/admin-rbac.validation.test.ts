/**
 * Characterization tests for adminRbacValidators (FWE Wave H, FAZA 1).
 *
 * These lock the CURRENT behavior of the kernel admin-RBAC request validator as the
 * safety net the zod migration (FAZA 2) must preserve — every assertion below is GREEN
 * against the hand-written validator, so a zod rewrite that changes a field's
 * accept/reject decision (or which field carries the error) flips a test. They assert
 * the validation LOGIC (which field is rejected, __isValid), NOT exact i18n message
 * text (brittle): a rejected field is asserted via a non-empty error string.
 *
 * The validator lives in `.shared-kernel/policies/validation/admin-rbac.validation.ts`
 * and is spread (via adminValidators) into VALIDATION_POLICY.validators. It is the
 * single guard in front of the admin "update role permissions" command (createMany on a
 * custom is_system=false role), so its element-type guard is a SECURITY boundary: a
 * non-string / empty-string permission_id must surface as a clean 400, never reach
 * Prisma and surface as an unhandled 500.
 *
 * Follows the gallery.validation.test.ts exemplar shape.
 */
import { describe, it, expect } from 'vitest';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

const V = VALIDATION_POLICY.validators;

// Helper: a field is "rejected" when its accumulated error string is non-empty.
const rejected = (r: Record<string, unknown>, field: string): boolean =>
  typeof r[field] === 'string' && (r[field] as string).trim().length > 0;

describe('adminRbacValidators.adminUpdatePermissions', () => {
  const valid = {
    role_id: 'role-1',
    permission_ids: ['perm-1', 'perm-2'],
  };

  it('accepts a well-formed payload', () => {
    const r = V.adminUpdatePermissions({ ...valid });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'role_id')).toBe(false);
    expect(rejected(r, 'permission_ids')).toBe(false);
  });

  it('accepts an EMPTY permission_ids array (revokes all permissions from the role)', () => {
    // DECISION in the validator: [] is valid by design — it revokes all permissions.
    const r = V.adminUpdatePermissions({ ...valid, permission_ids: [] });
    expect(r.__isValid).toBe(true);
    expect(rejected(r, 'permission_ids')).toBe(false);
  });

  describe('role_id', () => {
    it('rejects an empty-string role_id', () => {
      const r = V.adminUpdatePermissions({ ...valid, role_id: '' });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
    });

    it('rejects a missing / undefined role_id', () => {
      const r = V.adminUpdatePermissions({
        permission_ids: ['perm-1'],
      } as unknown as typeof valid);
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
    });

    it('rejects a null role_id', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        role_id: null as unknown as string,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
    });

    it('rejects a non-string role_id (number)', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        role_id: 123 as unknown as string,
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
    });
  });

  describe('permission_ids', () => {
    it('rejects a non-array permission_ids (string)', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        permission_ids: 'perm-1' as unknown as string[],
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('rejects a missing / undefined permission_ids', () => {
      const r = V.adminUpdatePermissions({
        role_id: 'role-1',
      } as unknown as typeof valid);
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('rejects a null permission_ids', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        permission_ids: null as unknown as string[],
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('SECURITY: rejects a non-string element inside permission_ids (number)', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        permission_ids: ['perm-1', 123 as unknown as string],
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('SECURITY: rejects an empty-string element inside permission_ids', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        permission_ids: ['perm-1', ''],
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('SECURITY: rejects a null element inside permission_ids', () => {
      const r = V.adminUpdatePermissions({
        ...valid,
        permission_ids: ['perm-1', null as unknown as string],
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });
  });

  describe('edge cases', () => {
    it('rejects a null payload (both fields fail)', () => {
      const r = V.adminUpdatePermissions(null);
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('rejects an undefined payload (both fields fail)', () => {
      const r = V.adminUpdatePermissions(undefined);
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('rejects an empty-object payload (both fields fail)', () => {
      const r = V.adminUpdatePermissions({});
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('accumulates BOTH field errors when both are invalid', () => {
      const r = V.adminUpdatePermissions({
        role_id: '',
        permission_ids: [''],
      });
      expect(r.__isValid).toBe(false);
      expect(rejected(r, 'role_id')).toBe(true);
      expect(rejected(r, 'permission_ids')).toBe(true);
    });

    it('keeps __general empty (validator never writes to it)', () => {
      const r = V.adminUpdatePermissions({ ...valid });
      expect(r.__general).toBe('');
    });
  });
});
