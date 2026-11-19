import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useActivationProgress } from './useActivationProgress';
const storage = vi.hoisted(() => new Map<string, string>());
vi.mock(
  '../../../../application/client-device-storage/local-storage-adapter/localStorage.adapter',
  () => ({
    getLocalStorage: (key: string) => storage.get(key),
    setLocalStorage: (key: string, value: string) => storage.set(key, value),
  })
);
const empty = {
  photoCount: 0,
  pinnedCount: 0,
  profileDetailsComplete: false,
  pairedClientCount: 0,
  pendingSharesCount: 0,
  accountId: 'A',
};
const complete = {
  ...empty,
  photoCount: 1,
  pinnedCount: 1,
  profileDetailsComplete: true,
  pairedClientCount: 1,
  pendingSharesCount: 1,
};
beforeEach(() => storage.clear());
describe('activation identity and high-water progress', () => {
  it('retains received-session progress when the shared session expires', () => {
    const view = renderHook(props => useActivationProgress(props), {
      initialProps: complete,
    });
    act(() => view.rerender({ ...complete, pendingSharesCount: 0 }));
    expect(view.result.current.isComplete).toBe(true);
    expect(view.result.current.doneCount).toBe(4);
  });
  it('never transfers completed milestones to a different account', () => {
    const view = renderHook(props => useActivationProgress(props), {
      initialProps: complete,
    });
    act(() => view.rerender({ ...empty, accountId: 'B' }));
    expect(view.result.current.doneCount).toBe(0);
    expect(view.result.current.isComplete).toBe(false);
    act(() => view.rerender(empty));
    expect(view.result.current.isComplete).toBe(true);
  });
  it('a pinned work without a public name and city leaves the profile step open', () => {
    const view = renderHook(props => useActivationProgress(props), {
      initialProps: { ...complete, profileDetailsComplete: false },
    });
    expect(view.result.current.profile).toBe(false);
  });
});
