import { describe, expect, it } from 'vitest';
import { isRoleEditable } from './AdminPermissionsMatrix.organism';

describe('permission matrix role editability', () => {
  it('locks system roles', () => {
    expect(isRoleEditable({ is_system: true })).toBe(false);
  });

  it('allows custom roles', () => {
    expect(isRoleEditable({ is_system: false })).toBe(true);
  });
});
