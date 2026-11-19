/**
 * Session handlers bound through `defineEndpoint(contract)`.
 * Pins a command 400 and the lenient list `take` (bad values fall back to 50).
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import * as sessionOps from '@domain/user/operations/user-session.operations';
import deleteExactly from '../../pages/api/v1/session/delete/exactly/index';
import getAll from '../../pages/api/v1/session/get-all/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';

describe('session through the API contract', () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    __setCurrentUser(makeCurrentUserOutput(makeClientCurrentUser()));
  });

  it('delete exactly: a missing id is 400 and never reaches the operation', async () => {
    const del = vi.spyOn(sessionOps, 'deleteSession_IO');
    const { status, event, data } = await mockApiHandler<{ id?: string }>(
      deleteExactly,
      { method: 'POST', body: {} }
    );
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(data.id).toContain('validation.session.');
    expect(del).not.toHaveBeenCalled();
  });

  it('get-all: a bad take falls back to 50 and the list still returns', async () => {
    const list = vi
      .spyOn(sessionOps, 'getAllSessionsOfUser_IO')
      .mockResolvedValue({ sessions: [], nextCursor: null });
    const { status } = await mockApiHandler(getAll, {
      method: 'GET',
      query: { take: 'nope', cursor: '' },
    });
    expect(status).toBe(200);
    expect(list.mock.calls[0]?.[0]).toEqual(
      expect.objectContaining({ take: 50 })
    );
    expect(list.mock.calls[0]?.[0]).not.toHaveProperty('cursor');
  });
});
