import { describe, expect, it, vi } from 'vitest';
import { PLATFORM_CONFIG } from '@kernel/domain/platform/platform.config';

const h = vi.hoisted(() => ({
  corsOrigins: [] as string[],
  env: {
    FRONTEND_PUBLIC_DOMAIN: 'front.example.test',
    FRONTEND_PUBLIC_PORT: '',
  },
}));

vi.mock('@app/cors/cors.config', () => ({
  CORS_ALLOWED_ORIGINS: h.corsOrigins,
}));

vi.mock('@app/environment/environment.config', () => ({
  ENV_VARS: h.env,
}));

vi.mock('@app/environment/environment.utils.api', () => ({
  IS_DEVELOPMENT_ENV: () => false,
}));

import {
  buildBridgeRedirectUrl,
  toNativeOAuthReturnIfMarked,
} from './auth-token-bridge';

describe('buildBridgeRedirectUrl', () => {
  it('keeps /en/app/onboarding + role=stylist and swaps origin when host is not CORS-allowed', () => {
    const url = buildBridgeRedirectUrl(
      'https://api.example.test/en/app/onboarding?role=stylist',
      'c0de'
    );
    const parsed = new URL(url);
    expect(parsed.origin).toBe('https://front.example.test');
    expect(parsed.pathname).toBe('/en/app/onboarding');
    expect(parsed.searchParams.get('role')).toBe('stylist');
    expect(parsed.searchParams.get('authCode')).toBe('c0de');
  });
});

describe('toNativeOAuthReturnIfMarked', () => {
  it('strips nativeAuth and returns the nailfolio:// path when marked', () => {
    expect(
      toNativeOAuthReturnIfMarked(
        'https://front/en/app?authCode=x&nativeAuth=1'
      )
    ).toBe(`${PLATFORM_CONFIG.DEEP_LINK_SCHEME}en/app?authCode=x`);
  });

  it('returns null when the native marker is absent', () => {
    expect(
      toNativeOAuthReturnIfMarked('https://front/en/app?authCode=x')
    ).toBeNull();
  });
});
