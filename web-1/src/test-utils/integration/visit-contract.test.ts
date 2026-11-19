/**
 * Visit handlers bound through `defineEndpoint(VISIT_CONTRACTS.KEY)`.
 * A manual visit without a client id is 400. A missing client id on the list
 * stays `{ client_user_id: 'Required' }`. A bad take falls back to 20.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import createHandler from '../../pages/api/v1/visit/create-manual/index';
import listHandler from '../../pages/api/v1/visit/client-visits/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  create: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@domain/visit/operations/visit-record.operations', () => ({
  createManualVisit_IO: ops.create,
  getClientVisits_IO: ops.list,
  updateVisitServiceNote_IO: vi.fn(),
  deleteManualVisit_IO: vi.fn(),
}));

describe('visit through the API contract', () => {
  beforeEach(() => {
    ops.create.mockReset();
    ops.list.mockReset();
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    __setPermission(true);
  });

  it('create: a body without a client id is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(createHandler, {
      method: 'POST',
      body: { visit_date: '2020-01-01' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.create).not.toHaveBeenCalled();
  });

  it('list: a missing client id stays the Required literal', async () => {
    const { status, data } = await mockApiHandler(listHandler, {
      method: 'GET',
      query: {},
    });
    expect(status).toBe(400);
    expect(data).toEqual({ client_user_id: 'Required' });
    expect(ops.list).not.toHaveBeenCalled();
  });

  it('list: a bad take falls back to 20 and is not a 400', async () => {
    ops.list.mockResolvedValue({
      success: true,
      data: {
        visits: [],
        nextCursor: null,
        historyAccess: {
          isLocked: false,
          canViewHistory: true,
          retentionDays: 0,
        },
        expiredSessions: [],
      },
    });
    const { status } = await mockApiHandler(listHandler, {
      method: 'GET',
      query: { client_user_id: 'client_1', take: 'nope' },
    });
    expect(status).toBe(200);
    expect(ops.list.mock.calls[0]?.[0].take).toBe(20);
  });
});
