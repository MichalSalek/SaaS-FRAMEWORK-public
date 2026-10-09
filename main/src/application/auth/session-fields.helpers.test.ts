import { describe, it, expect, vi } from 'vitest';

// ---------------------------------------------------------------------------
// Mock @kernel/domain/user-and-account/role_switch.config BEFORE importing
// session-fields.helpers.ts.
//
// REASON: READONLY-shared-kernel/tsconfig.json has `"extends": "../tsconfig.base.json"`
// which Vite's esbuild plugin cannot resolve (the base.json lives one level above
// the READONLY copy, not resolvable from the subdir path). Mocking the module
// prevents Vite from having to transform/parse that file at all. The mock
// replicates the exact runtime values: AccountTypeValue = {STYLIST,CLIENT} and
// isValidAccountType guards for those two strings exactly.
// ---------------------------------------------------------------------------
vi.mock('@kernel/domain/user-and-account/role_switch.config', () => ({
  AccountTypeValue: Object.freeze({ STYLIST: 'STYLIST', CLIENT: 'CLIENT' }),
  isValidAccountType: (v: unknown): boolean =>
    v === 'STYLIST' || v === 'CLIENT',
}));

import {
  getSessionRoleId,
  getSessionAccountType,
} from './session-fields.helpers';

// String literals matching the (mocked) AccountTypeValue — avoids a runtime
// import of the kernel module itself in the test file.
const STYLIST = 'STYLIST' as const;
const CLIENT = 'CLIENT' as const;

// ---------------------------------------------------------------------------
// Session fixture typed against the exact parameter expected by the helpers.
// Using Parameters<...> ensures the fixture stays in sync with the helper
// signature without duplicating the type definition here.
// ---------------------------------------------------------------------------

type FullSession = NonNullable<Parameters<typeof getSessionRoleId>[0]>;

function makeSession(userExtra: Record<string, unknown> = {}): FullSession {
  return {
    session: {
      id: 'ses_1',
      userId: 'usr_1',
      expiresAt: new Date('2099-01-01'),
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      token: 'tok_test',
    },
    user: {
      id: 'usr_1',
      email: 'test@example.com',
      name: 'Test User',
      createdAt: new Date('2024-01-01'),
      updatedAt: new Date('2024-01-01'),
      emailVerified: true,
      image: null,
      ...userExtra,
    },
  };
}

// ---------------------------------------------------------------------------
// getSessionRoleId
// ---------------------------------------------------------------------------

describe('getSessionRoleId', () => {
  it('returns the role_id string when present', () => {
    const session = makeSession({ role_id: 'ROLE_STYLIST' });
    expect(getSessionRoleId(session)).toBe('ROLE_STYLIST');
  });

  it('returns any string role_id value as-is', () => {
    const session = makeSession({ role_id: 'custom-role-123' });
    expect(getSessionRoleId(session)).toBe('custom-role-123');
  });

  it('returns null when role_id is absent from user', () => {
    const session = makeSession();
    expect(getSessionRoleId(session)).toBeNull();
  });

  it('returns null when role_id is null', () => {
    const session = makeSession({ role_id: null });
    expect(getSessionRoleId(session)).toBeNull();
  });

  it('returns null when role_id is undefined', () => {
    const session = makeSession({ role_id: undefined });
    expect(getSessionRoleId(session)).toBeNull();
  });

  it('returns null when role_id is a number (not a string)', () => {
    const session = makeSession({ role_id: 42 });
    expect(getSessionRoleId(session)).toBeNull();
  });

  it('returns null when role_id is an object', () => {
    const session = makeSession({ role_id: { id: 'role' } });
    expect(getSessionRoleId(session)).toBeNull();
  });

  it('returns null when session is undefined', () => {
    expect(getSessionRoleId(undefined)).toBeNull();
  });

  it('returns null when session is null', () => {
    expect(getSessionRoleId(null as never)).toBeNull();
  });

  it('returns null when session has no user property (user is null)', () => {
    const sessionWithoutUser = { ...makeSession(), user: null } as never;
    expect(getSessionRoleId(sessionWithoutUser)).toBeNull();
  });

  it('returns empty string when role_id is empty string (still a string)', () => {
    // Empty string passes `typeof value === "string"` — helper returns it as-is.
    const session = makeSession({ role_id: '' });
    expect(getSessionRoleId(session)).toBe('');
  });
});

// ---------------------------------------------------------------------------
// getSessionAccountType
// ---------------------------------------------------------------------------

describe('getSessionAccountType', () => {
  it('returns "STYLIST" when account_type is "STYLIST"', () => {
    const session = makeSession({ account_type: STYLIST });
    expect(getSessionAccountType(session)).toBe(STYLIST);
  });

  it('returns "CLIENT" when account_type is "CLIENT"', () => {
    const session = makeSession({ account_type: CLIENT });
    expect(getSessionAccountType(session)).toBe(CLIENT);
  });

  it('returns null when account_type is absent', () => {
    const session = makeSession();
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is null', () => {
    const session = makeSession({ account_type: null });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is undefined', () => {
    const session = makeSession({ account_type: undefined });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is lowercase "stylist" (enum is uppercase)', () => {
    const session = makeSession({ account_type: 'stylist' });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is lowercase "client"', () => {
    const session = makeSession({ account_type: 'client' });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is an arbitrary string ("ADMIN")', () => {
    const session = makeSession({ account_type: 'ADMIN' });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is a number', () => {
    const session = makeSession({ account_type: 1 });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when account_type is an object', () => {
    const session = makeSession({ account_type: { type: 'STYLIST' } });
    expect(getSessionAccountType(session)).toBeNull();
  });

  it('returns null when session is undefined', () => {
    expect(getSessionAccountType(undefined)).toBeNull();
  });

  it('returns null when session is null', () => {
    expect(getSessionAccountType(null as never)).toBeNull();
  });

  it('returns null when session has no user property (user is null)', () => {
    const sessionWithoutUser = { ...makeSession(), user: null } as never;
    expect(getSessionAccountType(sessionWithoutUser)).toBeNull();
  });
});
