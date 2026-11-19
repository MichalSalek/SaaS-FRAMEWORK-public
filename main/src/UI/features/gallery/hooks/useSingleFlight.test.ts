import { describe, it, expect, vi } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useSingleFlight } from './useSingleFlight';

describe('useSingleFlight', () => {
  it('ignores a second call while the first is in flight', async () => {
    let finish: () => void = () => undefined;
    const action = vi.fn(
      () =>
        new Promise<void>(resolve => {
          finish = resolve;
        })
    );
    const { result } = renderHook(() => useSingleFlight(action));

    const first = result.current();
    void result.current();
    expect(action).toHaveBeenCalledTimes(1);

    await act(async () => {
      finish();
      await first;
    });
    void result.current();
    expect(action).toHaveBeenCalledTimes(2);
  });

  it('releases the latch when the action throws', async () => {
    const action = vi.fn(() => Promise.reject(new Error('fail')));
    const { result } = renderHook(() => useSingleFlight(action));

    await expect(result.current()).rejects.toThrow('fail');
    await expect(result.current()).rejects.toThrow('fail');
    expect(action).toHaveBeenCalledTimes(2);
  });
});
