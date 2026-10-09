import { describe, expect, it } from 'vitest';
import { isRoleEditable } from './AdminPermissionsMatrix.organism';

describe('permission matrix role editability', () => {
  it.each(['MASTER_ADMIN', 'NOT_LOGGED_IN', 'STYLIST_ROLE', 'CLIENT_ROLE'])(
    'locks the system role %s',
    () => {
      expect(isRoleEditable({ is_system: true })).toBe(false);
    }
  );

  it('allows custom roles', () => {
    expect(isRoleEditable({ is_system: false })).toBe(true);
  });
});
