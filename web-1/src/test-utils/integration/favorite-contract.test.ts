/**
 * Favorites handlers bound through `defineEndpoint(contract)`.
 *
 * What the contract must decide on its own, with no per-handler declaration:
 *   - the method gate (405 + Allow from `contract.method`);
 *   - RBAC on the contract key with the REAL permission matrix (a stylist is refused, 403);
 *   - the request parser (400 before any business logic, the operation is never called);
 *   - the query decoding of a GET (defaults and the lenient fallback of the old qStr/qInt);
 *   - the response check in tests: a handler whose payload drifts from the response schema fails
 *     (500), it does not ship an untyped payload.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import addRecord from '../../pages/api/v1/favorite/add-record/index';
import getRecords from '../../pages/api/v1/favorite/get-records/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import type { EndpointScope } from '@app/http/define-endpoint';
import type { FAVORITE_CONTRACTS } from '@kernel/domain/favorites/favorite.contracts';
import {
  makeCurrentUserOutput,
  makeClientCurrentUser,
  makeStylistCurrentUser,
} from '../fixtures';

const ops = vi.hoisted(() => ({
  add: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@domain/favorites/operations/favorite-records.operations', () => ({
  addRecordToFavorites_IO: ops.add,
  getFavoriteRecords_IO: ops.list,
  removeRecordFromFavorites_IO: vi.fn(),
  updateRecordNote_IO: vi.fn(),
}));

const CLIENT = makeClientCurrentUser();

// Compile-time witness (a wrong boolean is a tsc error): the handler can only answer with a declared
// success event and the contract payload, and can only audit a declared audit event.
type AddScope = EndpointScope<typeof FAVORITE_CONTRACTS.FAVORITE_ADD_RECORD>;
type Assignable<A, B> = [A] extends [B] ? true : false;
const witness: {
  undeclaredSuccessEvent: Assignable<
    'SUCCESS',
    Parameters<AddScope['created']>[1]
  >;
  declaredSuccessEvent: Assignable<
    'FAVORITE_RECORD_ADDED',
    Parameters<AddScope['created']>[1]
  >;
  payloadOfAnotherEndpoint: Assignable<
    { success: boolean },
    Parameters<AddScope['created']>[0]
  >;
  undeclaredAuditEvent: Assignable<
    'FAVORITE_RECORDS_FETCHED',
    Parameters<AddScope['audit']>[0]
  >;
} = {
  undeclaredSuccessEvent: false,
  declaredSuccessEvent: true,
  payloadOfAnotherEndpoint: false,
  undeclaredAuditEvent: false,
};

const storedLike = (note: unknown) => ({
  success: true,
  data: {
    id: 'fav_1',
    client_user_id: CLIENT.id,
    gallery_record_id: 'gr_1',
    note,
  },
});

describe('favorites through the API contract', () => {
  it('keeps the compile-time witness', () => {
    expect(witness.declaredSuccessEvent).toBe(true);
  });

  beforeEach(() => {
    ops.add.mockReset();
    ops.list.mockReset();
    __setCurrentUser(makeCurrentUserOutput(CLIENT));
    __setPermission(null); // the real role-permission matrix decides
  });

  it('add-record: a client like answers 201 with the contract event and payload', async () => {
    ops.add.mockResolvedValue(storedLike('hi'));
    const { status, event, data } = await mockApiHandler(addRecord, {
      method: 'POST',
      body: { gallery_record_id: 'gr_1', note: 'hi' },
    });
    expect(status).toBe(201);
    expect(event).toBe('FAVORITE_RECORD_ADDED');
    expect(data).toEqual({
      id: 'fav_1',
      client_user_id: CLIENT.id,
      gallery_record_id: 'gr_1',
      note: 'hi',
    });
    expect(ops.add).toHaveBeenCalledWith({
      gallery_record_id: 'gr_1',
      id: CLIENT.id,
      note: 'hi',
    });
  });

  it('add-record: a body without gallery_record_id is a 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(addRecord, {
      method: 'POST',
      body: { note: 'hi' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.add).not.toHaveBeenCalled();
  });

  it('add-record: a note over NOTE_MAX is a 400', async () => {
    const { status } = await mockApiHandler(addRecord, {
      method: 'POST',
      body: { gallery_record_id: 'gr_1', note: 'x'.repeat(501) },
    });
    expect(status).toBe(400);
    expect(ops.add).not.toHaveBeenCalled();
  });

  it('add-record: unknown keys are stripped before the handler (parsed output only)', async () => {
    ops.add.mockResolvedValue(storedLike(null));
    await mockApiHandler(addRecord, {
      method: 'POST',
      body: { gallery_record_id: 'gr_1', id: 'someone_else' },
    });
    expect(ops.add).toHaveBeenCalledWith({
      gallery_record_id: 'gr_1',
      id: CLIENT.id,
      note: null,
    });
  });

  it('add-record: a stylist is refused by RBAC on the contract key (403)', async () => {
    __setCurrentUser(makeCurrentUserOutput(makeStylistCurrentUser()));
    const { status } = await mockApiHandler(addRecord, {
      method: 'POST',
      body: { gallery_record_id: 'gr_1' },
    });
    expect(status).toBe(403);
    expect(ops.add).not.toHaveBeenCalled();
  });

  it('add-record: a GET is 405 with Allow taken from the contract', async () => {
    const result = await mockApiHandler(addRecord, { method: 'GET' });
    expect(result.status).toBe(405);
    expect(result.data).toEqual({ allowed: 'POST' });
  });

  it('add-record: a payload that drifts from the response schema fails the request (500)', async () => {
    ops.add.mockResolvedValue(storedLike(42));
    const { status } = await mockApiHandler(addRecord, {
      method: 'POST',
      body: { gallery_record_id: 'gr_1' },
    });
    expect(status).toBe(500);
  });

  it('get-records: query fields are decoded by the contract (defaults, fallback, floor, arrays ignored)', async () => {
    ops.list.mockResolvedValue({
      success: true,
      data: { records: [], nextCursor: null },
    });
    const cases: ReadonlyArray<
      [Record<string, string | string[]>, { cursor?: string; take: number }]
    > = [
      [{}, { take: 50 }],
      [{ take: 'abc' }, { take: 50 }],
      [{ take: '1.5' }, { take: 1 }],
      [
        { cursor: 'c1', take: '10' },
        { cursor: 'c1', take: 10 },
      ],
      [{ cursor: ['a', 'b'], take: '' }, { take: 50 }],
    ];
    for (const [query, expected] of cases) {
      ops.list.mockClear();
      const { status, event } = await mockApiHandler(getRecords, {
        method: 'GET',
        query,
      });
      expect(status).toBe(200);
      expect(event).toBe('FAVORITE_RECORDS_FETCHED');
      expect(ops.list).toHaveBeenCalledWith({ id: CLIENT.id, ...expected });
    }
  });
});
