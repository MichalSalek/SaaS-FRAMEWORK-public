import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { createQueryWrapper } from '../../../../../test-utils/renderWithProviders';
const upsert = vi.hoisted(() => vi.fn());
vi.mock('../../../../../domain/visit/visitIO.possibilities.api', () => ({
  upsertClientImportantNote_IO: upsert,
  getClientImportantNote_IO: vi.fn(),
}));
import { useUpsertClientImportantNote } from './useClientImportantNote';
describe('important-note revision chain', () => {
  it('uses exactly the compared revision for an explicit overwrite', async () => {
    const first = '2026-10-22T10:00:00.000Z';
    upsert
      .mockReset()
      .mockResolvedValueOnce({
        note: 'one',
        updatedAt: '2026-10-22T11:00:00.000Z',
      })
      .mockResolvedValueOnce({
        note: 'mine',
        updatedAt: '2026-10-22T12:00:00.000Z',
      });
    const view = renderHook(() => useUpsertClientImportantNote('client'), {
      wrapper: createQueryWrapper(),
    });
    await act(async () => {
      await view.result.current.mutateAsync({
        note: 'one',
        expectedUpdatedAt: first,
      });
    });
    await act(async () => {
      await view.result.current.mutateAsync({
        note: 'mine',
        expectedUpdatedAt: first,
        exactRevision: true,
      });
    });
    expect(upsert.mock.calls[1]?.[0].expected_updated_at).toBe(first);
  });
  it("chains queued writes only through this editor's confirmed revisions, including clear", async () => {
    let release!: () => void;
    upsert
      .mockReset()
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            release = () =>
              resolve({ note: 'one', updatedAt: '2026-10-22T11:00:00.000Z' });
          })
      )
      .mockResolvedValueOnce({
        note: null,
        updatedAt: '2026-10-22T12:00:00.000Z',
      });
    const view = renderHook(() => useUpsertClientImportantNote('client'), {
      wrapper: createQueryWrapper(),
    });
    act(() => {
      view.result.current.mutate({
        note: 'one',
        expectedUpdatedAt: '2026-10-22T10:00:00.000Z',
      });
      view.result.current.mutate({
        note: '',
        expectedUpdatedAt: '2026-10-22T10:00:00.000Z',
      });
    });
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(1));
    await act(async () => release());
    await waitFor(() => expect(upsert).toHaveBeenCalledTimes(2));
    expect(
      upsert.mock.calls.map(([request]) => request.expected_updated_at)
    ).toEqual(['2026-10-22T10:00:00.000Z', '2026-10-22T11:00:00.000Z']);
    expect(upsert.mock.calls[1]?.[0]).toMatchObject({
      client_user_id: 'client',
      note: '',
    });
  });
});
