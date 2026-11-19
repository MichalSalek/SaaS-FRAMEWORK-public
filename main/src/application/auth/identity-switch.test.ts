import { describe, it, expect } from 'vitest';
import {
  IMPERSONATION_RETURN_FALLBACK,
  resolveImpersonationReturnUrl,
} from './identity-switch';

describe('resolveImpersonationReturnUrl', () => {
  it('keeps an admin path with its query (filters survive the round trip)', () => {
    expect(
      resolveImpersonationReturnUrl(
        '/app/admin/users?q=anna&role=STYLIST&user=abc'
      )
    ).toBe('/app/admin/users?q=anna&role=STYLIST&user=abc');
  });

  it('keeps a locale-prefixed admin path with its query', () => {
    expect(
      resolveImpersonationReturnUrl('/en/app/admin/users?q=anna&role=STYLIST')
    ).toBe('/en/app/admin/users?q=anna&role=STYLIST');
    expect(resolveImpersonationReturnUrl('/de/app/admin')).toBe(
      '/de/app/admin'
    );
  });

  it('accepts the admin root', () => {
    expect(resolveImpersonationReturnUrl('/app/admin')).toBe('/app/admin');
  });

  it.each([
    null,
    '',
    '/app',
    '/app/administrator',
    '/fr/app/admin/users',
    '/en/app',
    'https://evil.example/app/admin',
    '//evil.example/app/admin',
    '/app/admin\\..\\evil',
    '/app/admin/users\n',
    'javascript:alert(1)',
  ])('falls back for %j', raw => {
    expect(resolveImpersonationReturnUrl(raw)).toBe(
      IMPERSONATION_RETURN_FALLBACK
    );
  });

  it('falls back to the admin users list', () => {
    expect(IMPERSONATION_RETURN_FALLBACK).toBe('/app/admin/users');
  });
});
