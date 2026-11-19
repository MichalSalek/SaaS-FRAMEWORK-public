import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

const harness = vi.hoisted(() => ({
  lookup: vi.fn(),
  detect: vi.fn(async () => [{ rawValue: 'stylist-one' }]),
}));
vi.mock('../../../../domain/account/accountIO.possibilities.api', () => ({
  getPublicProfile_IO: harness.lookup,
}));
vi.mock('../../../../application/platform/screen-brightness', () => ({
  requestMaxBrightness: async () => ({ release: async () => undefined }),
}));
vi.mock('../../../../application/platform/haptics', () => ({
  hapticImpact: vi.fn(),
}));
import { useQrScanner } from './useQrScanner';

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
  harness.lookup.mockReset();
});

describe('scanner lifecycle', () => {
  it('ignores a lookup from a scanner closed and reopened during the request', async () => {
    vi.useFakeTimers();
    let finish!: (value: unknown) => void;
    harness.lookup.mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve;
        })
    );
    vi.stubGlobal(
      'BarcodeDetector',
      class {
        detect = harness.detect;
      }
    );
    vi.stubGlobal('navigator', {
      mediaDevices: {
        getUserMedia: async () => ({ getTracks: () => [{ stop: vi.fn() }] }),
      },
    });

    const view = renderHook(({ open }) => useQrScanner(open), {
      initialProps: { open: true },
    });
    await act(async () => {});
    Object.assign(view.result.current.videoRef, {
      current: { readyState: 2, srcObject: null, play: async () => undefined },
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(250);
    });
    expect(harness.lookup).toHaveBeenCalledTimes(1);
    view.rerender({ open: false });
    view.rerender({ open: true });
    await act(async () => {});
    expect(view.result.current.phase).toBe('scanning');

    await act(async () => {
      finish({ account: { account_id: 'old', display_name: 'Old' } });
    });
    expect(view.result.current.phase).toBe('scanning');
    expect(view.result.current.found).toBeNull();
    view.unmount();
  });
});
