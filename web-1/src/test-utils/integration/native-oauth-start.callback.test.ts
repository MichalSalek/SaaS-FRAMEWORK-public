/**
 * Unit coverage for resolveNativeCallbackURL (D6 locale-prefixed app paths).
 * Auth / Better Auth init is stubbed so the handler module can load in Vitest.
 */

import { describe, expect, it, vi } from 'vitest';

vi.mock('@app/auth/better-auth/better-auth.config', () => ({
  auth: { api: { signInSocial: vi.fn() } },
}));

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import { resolveNativeCallbackURL } from '../../pages/api/auth/native-oauth-start/[provider]';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';

const FALLBACK = `${ROUTES_FRONT_APP.APP}?nativeAuth=1`;

describe('resolveNativeCallbackURL', () => {
  it('/en/app → /en/app?nativeAuth=1', () => {
    expect(resolveNativeCallbackURL('/en/app')).toBe('/en/app?nativeAuth=1');
  });

  it('/de/app/onboarding?role=stylist keeps role + marker', () => {
    const raw = resolveNativeCallbackURL('/de/app/onboarding?role=stylist');
    const parsed = new URL(raw, 'https://native.invalid');
    expect(parsed.pathname).toBe('/de/app/onboarding');
    expect(parsed.searchParams.get('role')).toBe('stylist');
    expect(parsed.searchParams.get('nativeAuth')).toBe('1');
  });

  it('/apple → fallback /app?nativeAuth=1', () => {
    expect(resolveNativeCallbackURL('/apple')).toBe(FALLBACK);
  });

  it('//evil and absolute URLs → fallback', () => {
    expect(resolveNativeCallbackURL('//evil')).toBe(FALLBACK);
    expect(resolveNativeCallbackURL('https://evil.example/app')).toBe(FALLBACK);
  });

  it('/fr/app (unknown locale) → fallback', () => {
    expect(resolveNativeCallbackURL('/fr/app')).toBe(FALLBACK);
  });
});
