// useSingleFlightSaves.test.ts
// Kontrakt kolejki autosave'u sekcji profilu: jeden zapis naraz, najnowszy
// snapshot per sekcja, trwały znacznik porażki i ponowienie ostatniego
// nieudanego snapshotu (DECISION w hooku).

import { describe, it, expect, vi } from 'vitest';
import { act, renderHook, waitFor } from '@testing-library/react';
import { useSingleFlightSaves } from './useSingleFlightSaves';

type Section = 'location' | 'social';

function deferred() {
  let resolve: () => void = () => undefined;
  let reject: (e: Error) => void = () => undefined;
  const promise = new Promise<void>((res, rej) => {
    resolve = () => res();
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe('useSingleFlightSaves', () => {
  it('sends one request at a time and keeps only the newest queued snapshot per section', async () => {
    const first = deferred();
    const mutateAsync = vi
      .fn<(payload: string) => Promise<unknown>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSingleFlightSaves<Section, string>(mutateAsync)
    );

    act(() => {
      result.current.save('location', 'A');
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.save('location', 'B');
      result.current.save('location', 'C');
    });
    expect(result.current.isSaving).toBe(true);
    // Still single-flight: B/C wait for A.
    expect(mutateAsync).toHaveBeenCalledTimes(1);

    await act(async () => {
      first.resolve();
    });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(mutateAsync.mock.calls.map(c => c[0])).toEqual(['A', 'C']);
    expect(result.current.failedSections.size).toBe(0);
  });

  it('marks a failed section and retry re-sends the failed snapshot', async () => {
    const mutateAsync = vi
      .fn<(payload: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSingleFlightSaves<Section, string>(mutateAsync)
    );

    act(() => {
      result.current.save('social', 'anna');
    });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect([...result.current.failedSections]).toEqual(['social']);

    act(() => {
      result.current.retry();
    });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(mutateAsync.mock.calls.map(c => c[0])).toEqual(['anna', 'anna']);
    expect(result.current.failedSections.size).toBe(0);
  });

  it('a newer snapshot of the same section supersedes its failure', async () => {
    const first = deferred();
    const mutateAsync = vi
      .fn<(payload: string) => Promise<unknown>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSingleFlightSaves<Section, string>(mutateAsync)
    );

    act(() => {
      result.current.save('location', 'old');
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    act(() => {
      result.current.save('location', 'new');
    });
    await act(async () => {
      first.reject(new Error('500'));
    });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    // The failed "old" snapshot was already replaced by "new", which succeeded.
    expect(result.current.failedSections.size).toBe(0);
    expect(mutateAsync.mock.calls.map(c => c[0])).toEqual(['old', 'new']);
  });

  it('discard drops the failure so a later retry does not resurrect the snapshot', async () => {
    const mutateAsync = vi
      .fn<(payload: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSingleFlightSaves<Section, string>(mutateAsync)
    );

    act(() => {
      result.current.save('social', 'typo');
    });
    await waitFor(() => expect(result.current.failedSections.size).toBe(1));
    act(() => {
      result.current.discard('social');
      result.current.retry();
    });
    expect(result.current.failedSections.size).toBe(0);
    expect(mutateAsync).toHaveBeenCalledTimes(1);
  });

  it('a failure in one section does not block or mark another section', async () => {
    const mutateAsync = vi
      .fn<(payload: string) => Promise<unknown>>()
      .mockRejectedValueOnce(new Error('vanity taken'))
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSingleFlightSaves<Section, string>(mutateAsync)
    );

    act(() => {
      result.current.save('social', 'x');
      result.current.save('location', 'y');
    });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(mutateAsync).toHaveBeenCalledTimes(2);
    expect([...result.current.failedSections]).toEqual(['social']);
  });
  it('isBusy reports a queued or in-flight section until its save settles', async () => {
    const first = deferred();
    const mutateAsync = vi
      .fn<(payload: string) => Promise<unknown>>()
      .mockReturnValueOnce(first.promise)
      .mockResolvedValue(undefined);
    const { result } = renderHook(() =>
      useSingleFlightSaves<Section, string>(mutateAsync)
    );

    expect(result.current.isBusy('location')).toBe(false);
    act(() => {
      result.current.save('location', 'A');
    });
    await waitFor(() => expect(mutateAsync).toHaveBeenCalledTimes(1));
    // In flight: a revert to the server value must still be queued.
    expect(result.current.isBusy('location')).toBe(true);
    expect(result.current.isBusy('social')).toBe(false);
    act(() => {
      result.current.save('location', 'X');
    });
    await act(async () => {
      first.resolve();
    });
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(result.current.isBusy('location')).toBe(false);
    expect(mutateAsync.mock.calls.map(c => c[0])).toEqual(['A', 'X']);
  });
});
