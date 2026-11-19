/**
 * Session-container handlers bound through `defineEndpoint(contract)`.
 * Pins the get-by-id literal 400 (missing, empty, repeated) and the lenient list take.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import getById from '../../pages/api/v1/session-container/get-by-id/index';
import getMy from '../../pages/api/v1/session-container/get-my/index';
import create from '../../pages/api/v1/session-container/create/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser } from '../setup';
import { makeCurrentUserOutput, makeClientCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  getById: vi.fn(),
  getMy: vi.fn(),
  create: vi.fn(),
}));

vi.mock(
  '@domain/session-container/operations/session-container.operations',
  () => ({
    getSessionContainerById_IO: ops.getById,
    getMySessionContainers_IO: ops.getMy,
    createSessionContainer_IO: ops.create,
    addPhotoToSessionContainer_IO: vi.fn(),
    removePhotoFromSessionContainer_IO: vi.fn(),
    shareSessionContainer_IO: vi.fn(),
    closeSessionContainer_IO: vi.fn(),
    setSessionContainerNote_IO: vi.fn(),
  })
);

const CLIENT = makeClientCurrentUser();
const CLIENT_ACCOUNT = CLIENT.client_account;
if (!CLIENT_ACCOUNT) {
  throw new Error('client fixture includes a client account');
}

const SESSION = {
  id: 'ses_1',
  clientAccountId: CLIENT_ACCOUNT.client_account_id,
  clientName: null,
  clientUserId: null,
  stylistAccountId: null,
  name: null,
  lifecycleState: 'DRAFT',
  stylistNote: null,
  clientNote: null,
  sharedAt: null,
  expiresAt: null,
  closedAt: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: '2026-01-01T00:00:00.000Z',
  photoCount: 0,
};

describe('session container through the API contract', () => {
  beforeEach(() => {
    ops.getById.mockReset();
    ops.getMy.mockReset();
    ops.create.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
  });

  it('get-by-id: missing, empty and repeated session_id stay the literal Required', async () => {
    for (const query of [{}, { session_id: '' }, { session_id: ['a', 'b'] }]) {
      const { status, event, data } = await mockApiHandler(getById, {
        method: 'GET',
        query: { ...query },
      });
      expect(status).toBe(400);
      expect(event).toBe('VALIDATION_FAILED');
      expect(data).toEqual({ session_id: 'Required' });
    }
    expect(ops.getById).not.toHaveBeenCalled();
  });

  it('get-by-id: a session id reaches the operation and returns the detail', async () => {
    ops.getById.mockResolvedValue({
      success: true,
      data: { ...SESSION, photos: [] },
    });
    const { status, event } = await mockApiHandler(getById, {
      method: 'GET',
      query: { session_id: 'ses_1' },
    });
    expect(status).toBe(200);
    expect(event).toBe('SESSION_CONTAINER_FETCHED');
    expect(ops.getById).toHaveBeenCalledWith(
      expect.objectContaining({ session_id: 'ses_1' })
    );
  });

  it('get-my: a bad take falls back to 50 and an empty list is 200', async () => {
    ops.getMy.mockResolvedValue({
      success: true,
      data: { sessions: [], nextCursor: null },
    });
    const { status, event } = await mockApiHandler(getMy, {
      method: 'GET',
      query: { take: 'nope' },
    });
    expect(status).toBe(200);
    expect(event).toBe('SESSION_CONTAINERS_FETCHED');
    expect(ops.getMy).toHaveBeenCalledWith(
      expect.objectContaining({ take: 50 })
    );
  });

  it('create: an empty stylist id is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(create, {
      method: 'POST',
      body: { stylist_account_id: '' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.create).not.toHaveBeenCalled();
  });

  it('create: an omitted stylist id creates the session', async () => {
    ops.create.mockResolvedValue({ success: true, data: SESSION });
    const { status, event } = await mockApiHandler(create, {
      method: 'POST',
      body: {},
    });
    expect(status).toBe(201);
    expect(event).toBe('SESSION_CONTAINER_CREATED');
    expect(ops.create).toHaveBeenCalledWith(
      expect.objectContaining({
        client_account_id: CLIENT_ACCOUNT.client_account_id,
        stylist_account_id: undefined,
      })
    );
  });
});
