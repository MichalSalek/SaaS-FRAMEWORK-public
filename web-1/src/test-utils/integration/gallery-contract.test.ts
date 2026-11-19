/**
 * Gallery handlers bound through `defineEndpoint(GALLERY_CONTRACTS.KEY)`.
 * A create body without a photo is 400. A missing record id stays the literal
 * `{ gallery_record_id: 'Required' }`. A bad take falls back to 50.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import createHandler from '../../pages/api/v1/gallery/create-gallery-record/index';
import byIdHandler from '../../pages/api/v1/gallery/get-record-by-id/index';
import listHandler from '../../pages/api/v1/gallery/get-gallery-records/index';
import { mockApiHandler } from '../mockApiHandler';
import { __setCurrentUser, __setPermission } from '../setup';
import { makeCurrentUserOutput, makeStylistCurrentUser } from '../fixtures';

const ops = vi.hoisted(() => ({
  create: vi.fn(),
  byId: vi.fn(),
  list: vi.fn(),
}));

vi.mock('@domain/gallery/operations/gallery-create.operation', () => ({
  createGalleryRecord_IO: ops.create,
}));
vi.mock('@domain/gallery/operations/gallery-detail.query', () => ({
  getGalleryRecordByID_IO: ops.byId,
}));
vi.mock('@domain/gallery/operations/gallery-list.query', () => ({
  getGalleryRecords_IO: ops.list,
}));

const STYLIST = makeStylistCurrentUser();

describe('gallery through the API contract', () => {
  beforeEach(() => {
    ops.create.mockReset();
    ops.byId.mockReset();
    ops.list.mockReset();
    __setCurrentUser(makeCurrentUserOutput(STYLIST));
    __setPermission(true);
  });

  it('create: a body without a photo is 400 and never reaches the operation', async () => {
    const { status, event } = await mockApiHandler(createHandler, {
      method: 'POST',
      body: { color_ids: ['c1'], trait_ids: ['t1'], nail_length: 'SHORT' },
    });
    expect(status).toBe(400);
    expect(event).toBe('VALIDATION_FAILED');
    expect(ops.create).not.toHaveBeenCalled();
  });

  it('get-by-id: a missing id stays the Required literal', async () => {
    const { status, data } = await mockApiHandler(byIdHandler, {
      method: 'GET',
      query: {},
    });
    expect(status).toBe(400);
    expect(data).toEqual({ gallery_record_id: 'Required' });
    expect(ops.byId).not.toHaveBeenCalled();
  });

  it('list: a bad take falls back to 50 and is not a 400', async () => {
    ops.list.mockResolvedValue({
      success: true,
      data: { records: [], nextCursor: null },
    });
    const { status } = await mockApiHandler(listHandler, {
      method: 'GET',
      query: { take: 'nope', color_ids: 'red,blue' },
    });
    expect(status).toBe(200);
    expect(ops.list.mock.calls[0]?.[0].props.take).toBe(50);
    expect(ops.list.mock.calls[0]?.[0].props.color_ids).toEqual([
      'red',
      'blue',
    ]);
  });
});
