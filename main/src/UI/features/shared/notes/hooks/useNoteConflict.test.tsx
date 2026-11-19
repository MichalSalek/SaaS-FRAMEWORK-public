import { StrictMode, type ReactNode } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { expect, it, vi } from 'vitest';
import { useNoteConflict } from './useNoteConflict';
const conflict = () =>
  Object.assign(new Error('conflict'), {
    httpError: {
      event: 'VALIDATION_FAILED',
      data: { field: 'note', message: 'validation.visit.crmNoteChanged' },
    },
  });
it('ignores an older comparison result after a later refresh', async () => {
  let finishOld!: (result: { note: string; updatedAt: string }) => void;
  let finishCurrent!: (result: { note: string; updatedAt: string }) => void;
  const load = vi
    .fn()
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishOld = resolve;
        })
    )
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishCurrent = resolve;
        })
    );
  const wrapper = ({ children }: { children: ReactNode }) => (
    <StrictMode>{children}</StrictMode>
  );
  const error = conflict();
  const view = renderHook(() => useNoteConflict(error, false, load), {
    wrapper,
  });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(1));
  act(() => {
    void view.result.current.refresh();
  });
  await waitFor(() => expect(load).toHaveBeenCalledTimes(2));
  await act(async () => {
    finishCurrent({ note: 'current', updatedAt: 'new' });
  });
  expect(view.result.current.state).toEqual({
    status: 'ready',
    current: { note: 'current', updatedAt: 'new' },
  });
  await act(async () => {
    finishOld({ note: 'stale', updatedAt: 'old' });
  });
  expect(view.result.current.state).toEqual({
    status: 'ready',
    current: { note: 'current', updatedAt: 'new' },
  });
});
