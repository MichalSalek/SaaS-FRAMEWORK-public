import { act, renderHook } from '@testing-library/react';
import { expect, it } from 'vitest';
import { useAddressReady } from './useAddressReady';

it('blocks a same-turn payment attempt before React commits the disabled button', () => {
  const { result } = renderHook(() => useAddressReady(true));
  act(() => {
    result.current[1](false);
    expect(result.current[0]).toBe(true);
    expect(result.current[2].current).toBe(false);
  });
  expect(result.current[0]).toBe(false);
});
