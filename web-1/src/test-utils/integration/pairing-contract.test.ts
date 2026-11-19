/**
 * Pairing handlers bound through `defineEndpoint(contract)`.
 *
 * Pins what must not change when the route stops parsing the query by hand:
 *   - a create without a stylist account id never reaches the operation;
 *   - a missing, empty or repeated stylist account id is still 400
 *     `{ stylist_account_id: 'Required' }` (not the unused i18n schema);
 *   - a normal id still calls the operation;
 *   - one strict route declares `limiterTier: 'strict'`;
 *   - a GET on a POST route is 405;
 *   - a bad take on get-my-pairs falls back to 50 and an empty cursor is absent.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import createRequest from '../../pages/api/v1/pairing/request-pair/index';
import accessStatus from '../../pages/api/v1/pairing/get-access-status/index';
import myPairs from '../../pages/api/v1/pairing/get-my-pairs/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';
import { PAIRING_CONTRACTS } from '@kernel/domain/pairing/pairing.contracts';

const ops = vi.hoisted(() => ({
  create: vi.fn(),
  status: vi.fn(),
  pairs: vi.fn(),
}));

vi.mock('@domain/pairing/operations/pair-request.operations', () => ({
  createPairRequest_IO: ops.create,
  respondPairRequest_IO: vi.fn(),
  cancelPairRequest_IO: vi.fn(),
}));

vi.mock('@domain/pairing/operations/pairing-access.operations', () => ({
  getAccessStatus_IO: ops.status,
  revokePairingAccess_IO: vi.fn(),
}));

vi.mock('@domain/pairing/operations/pairing-query.operations', () => ({
  getMyPairs_IO: ops.pairs,
  getPendingPairRequests_IO: vi.fn(),
  getMyPendingPairRequests_IO: vi.fn(),
}));

const CLIENT = makeClientCurrentUser();

describe('pairing through the API contract', () => {
  beforeEach(() => {
    ops.create.mockReset();
    ops.status.mockReset();
    ops.pairs.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
    __setPermission(true);
  });

  it('request-pair: a body without stylist_account_id is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(createRequest, {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.create).not.toHaveBeenCalled();
  });

  it('request-pair: a GET is 405 with Allow taken from the contract', async () => {
    const result = await mockApiHandler(createRequest, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.data).toEqual({ allowed: 'POST' });
  });

  it('request-pair contract field is the strict limiter', () => {
    expect(PAIRING_CONTRACTS.PAIR_REQUEST_CREATE.limiterTier).toBe('strict');
  });

  it('access status: missing, empty and a repeated id stay the literal Required 400', async () => {
    for (const query of [
      {},
      { stylist_account_id: '' },
      { stylist_account_id: ['a', 'b'] },
    ]) {
      ops.status.mockClear();
      const { status, event, data } = await mockApiHandler(accessStatus, {
        method: 'GET',
        query,
      });
      expect(status).toBe(400);
      expect(event).toBe('VALIDATION_FAILED');
      expect(data).toEqual({ stylist_account_id: 'Required' });
      expect(ops.status).not.toHaveBeenCalled();
    }
  });

  it('access status: a normal id calls the operation', async () => {
    ops.status.mockResolvedValue({
      success: true,
      data: { access: 'PUBLIC' },
    });
    const { status, event } = await mockApiHandler(accessStatus, {
      method: 'GET',
      query: { stylist_account_id: 'sa-1' },
    });
    expect(status).toBe(200);
    expect(event).toBe('PAIRING_ACCESS_STATUS_FETCHED');
    expect(ops.status).toHaveBeenCalledWith({
      client_user_id: CLIENT.id,
      stylist_account_id: 'sa-1',
    });
  });

  it('my-pairs: a bad take falls back to 50 and an empty cursor is absent', async () => {
    ops.pairs.mockResolvedValue({
      success: true,
      data: { pairs: [], nextCursor: null },
    });
    const { status, event } = await mockApiHandler(myPairs, {
      method: 'GET',
      query: { take: 'nope', cursor: '' },
    });
    expect(status).toBe(200);
    expect(event).toBe('PAIRING_PAIRS_FETCHED');
    expect(ops.pairs).toHaveBeenCalledWith({
      current_user_id: CLIENT.id,
      take: 50,
    });
  });
});
