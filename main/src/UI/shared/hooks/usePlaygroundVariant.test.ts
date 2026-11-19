import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, renderHook } from '@testing-library/react';
import { usePlaygroundVariant } from './usePlaygroundVariant';

const state = vi.hoisted(() => ({
  enabled: false,
  pg: undefined as undefined | string[],
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: { pg: state.pg } }),
}));
vi.mock(
  '../../../application/environment/environment.possibilities.api',
  () => ({ ARE_DEV_ROUTES_ENABLED: () => state.enabled })
);
afterEach(() => {
  cleanup();
  state.enabled = false;
  state.pg = undefined;
});

describe('playground production gate', () => {
  it('ignores query votes in production even with their query parameters', () => {
    state.pg = ['sample-look:a', 'sample-motion:a'];
    expect(
      renderHook(() => usePlaygroundVariant('sample-look')).result.current
    ).toBeNull();
    expect(
      renderHook(() => usePlaygroundVariant('sample-motion')).result.current
    ).toBeNull();
  });
  it('reads each independent vote in dev and leaves the unparameterized route unchanged', () => {
    state.enabled = true;
    expect(
      renderHook(() => usePlaygroundVariant('sample-look')).result.current
    ).toBeNull();
    state.pg = ['sample-look:b', 'sample-motion:b'];
    expect(
      renderHook(() => usePlaygroundVariant('sample-look')).result.current
    ).toBe('b');
    expect(
      renderHook(() => usePlaygroundVariant('sample-motion')).result.current
    ).toBe('b');
  });
});
