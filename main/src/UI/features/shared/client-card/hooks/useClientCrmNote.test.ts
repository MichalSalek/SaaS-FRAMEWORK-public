import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import {
  createQueryWrapper,
  makeTestQueryClient,
} from '../../../../../test-utils/renderWithProviders';
import { useUpsertClientCrmNote } from './useClientCrmNote';

type Note = { note: string | null; updatedAt: string | null };
const mocks = vi.hoisted(() => ({
  upsert: vi.fn<
    (
      input: {
        client_user_id: string;
        note: string;
        expected_updated_at: string | null;
      },
      options?: { silentBusinessError?: boolean }
    ) => Promise<Note>
  >(),
}));
vi.mock('../../../../../domain/visit/visitIO.possibilities.api', () => ({
  upsertClientCrmNote_IO: mocks.upsert,
  getClientCrmNote_IO: vi.fn(),
  deleteClientCrmNote_IO: vi.fn(),
}));

const first = '2026-10-24T10:00:00.000Z';
const second = '2026-10-24T11:00:00.000Z';
const third = '2026-10-24T12:00:00.000Z';
const fourth = '2026-10-24T13:00:00.000Z';
beforeEach(() => mocks.upsert.mockReset());

describe('CRM note save revision', () => {
  it('uses exactly the compared revision for an explicit overwrite', async () => {
    mocks.upsert
      .mockResolvedValueOnce({ note: 'one', updatedAt: second })
      .mockResolvedValueOnce({ note: 'mine', updatedAt: third });
    const { result } = renderHook(() => useUpsertClientCrmNote('client'), {
      wrapper: createQueryWrapper(),
    });
    await act(async () => {
      await result.current.mutateAsync({
        note: 'one',
        expectedUpdatedAt: first,
      });
    });
    await act(async () => {
      await result.current.mutateAsync({
        note: 'mine',
        expectedUpdatedAt: first,
        exactRevision: true,
      });
    });
    expect(mocks.upsert.mock.calls[1]?.[0].expected_updated_at).toBe(first);
  });
  it('sends the editor baseline, even if a newer GET is already in cache', async () => {
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.client.crmNote('client'), {
      note: 'external request append',
      updatedAt: third,
    });
    mocks.upsert.mockResolvedValue({ note: 'draft', updatedAt: fourth });
    const { result } = renderHook(() => useUpsertClientCrmNote('client'), {
      wrapper: createQueryWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        note: 'draft',
        expectedUpdatedAt: first,
      });
    });
    expect(mocks.upsert).toHaveBeenCalledWith(
      { client_user_id: 'client', note: 'draft', expected_updated_at: first },
      { silentBusinessError: true }
    );
  });

  it('advances a serialized queue through its own successful revision chain', async () => {
    let finishFirst = () => {};
    mocks.upsert
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finishFirst = () =>
              resolve({ note: 'first draft', updatedAt: second });
          })
      )
      .mockResolvedValueOnce({ note: 'second draft', updatedAt: third })
      .mockResolvedValueOnce({ note: 'third draft', updatedAt: fourth });
    const client = makeTestQueryClient();
    const { result } = renderHook(() => useUpsertClientCrmNote('client'), {
      wrapper: createQueryWrapper(client),
    });
    act(() => {
      result.current.mutate({ note: 'first draft', expectedUpdatedAt: first });
      result.current.mutate({ note: 'second draft', expectedUpdatedAt: first });
      result.current.mutate({ note: 'third draft', expectedUpdatedAt: first });
    });
    await waitFor(() => expect(mocks.upsert).toHaveBeenCalledTimes(1));
    await act(async () => {
      finishFirst();
    });
    await waitFor(() => expect(result.current.isSuccess).toBe(true));
    expect(
      mocks.upsert.mock.calls.map(([input]) => input.expected_updated_at)
    ).toEqual([first, second, third]);
    expect(client.getQueryData(queryKeys.client.crmNote('client'))).toEqual({
      note: 'third draft',
      updatedAt: fourth,
    });
  });

  it('does not adopt an external revision after its own save or replace newer cache on a conflict', async () => {
    mocks.upsert
      .mockResolvedValueOnce({ note: 'first draft', updatedAt: second })
      .mockRejectedValueOnce(new Error('revision changed'));
    const client = makeTestQueryClient();
    const { result } = renderHook(() => useUpsertClientCrmNote('client'), {
      wrapper: createQueryWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        note: 'first draft',
        expectedUpdatedAt: first,
      });
    });
    const external = {
      note: 'first draft\n\nClient request',
      updatedAt: third,
    };
    client.setQueryData(queryKeys.client.crmNote('client'), external);
    await act(async () => {
      await expect(
        result.current.mutateAsync({
          note: 'older queued draft',
          expectedUpdatedAt: first,
        })
      ).rejects.toThrow('revision changed');
    });
    expect(mocks.upsert.mock.calls[1]?.[0].expected_updated_at).toBe(second);
    expect(client.getQueryData(queryKeys.client.crmNote('client'))).toEqual(
      external
    );
  });

  it('starts a new revision chain after an explicit successful deletion clears the cached note', async () => {
    mocks.upsert
      .mockResolvedValueOnce({ note: 'first draft', updatedAt: first })
      .mockResolvedValueOnce({ note: 'new note', updatedAt: second });
    const client = makeTestQueryClient();
    client.setQueryData(queryKeys.client.crmNote('client'), {
      note: null,
      updatedAt: null,
    });
    const { result } = renderHook(() => useUpsertClientCrmNote('client'), {
      wrapper: createQueryWrapper(client),
    });
    await act(async () => {
      await result.current.mutateAsync({
        note: 'first draft',
        expectedUpdatedAt: null,
      });
    });
    client.setQueryData(queryKeys.client.crmNote('client'), {
      note: null,
      updatedAt: null,
    });
    await act(async () => {
      await result.current.mutateAsync({
        note: 'new note',
        expectedUpdatedAt: null,
      });
    });
    expect(
      mocks.upsert.mock.calls.map(([input]) => input.expected_updated_at)
    ).toEqual([null, null]);
  });
});
