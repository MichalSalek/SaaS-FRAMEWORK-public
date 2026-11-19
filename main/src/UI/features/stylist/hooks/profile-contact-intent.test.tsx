import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { withContactIntent } from './useProfileContactIntent';
import { useProfilePairIntent } from './useProfilePairIntent';

const router = vi.hoisted(() => ({
  isReady: true,
  query: { pair: '1', contact: '1' },
  asPath: '/stylist/abc?pair=1&contact=1',
  replace: vi.fn(),
}));
vi.mock('next/router', () => ({ useRouter: () => router }));

describe('contact and connection intent separation', () => {
  it('preserves the stylist and locale through login without starting a connection request', () => {
    expect(withContactIntent('/en/stylist/abc?pair=1&ref=qr')).toBe(
      '/en/stylist/abc?ref=qr&contact=1'
    );
  });
  it('does not execute a connection intent when a contact intent is present', () => {
    const request = vi.fn();
    renderHook(() => useProfilePairIntent('request', request));
    expect(request).not.toHaveBeenCalled();
    expect(router.replace).not.toHaveBeenCalled();
  });
});
