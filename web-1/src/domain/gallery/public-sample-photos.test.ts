import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: { use: { galleryRecord: { findMany: vi.fn() } } },
}));
vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));

import {
  fetchPublicSamplePhotos,
  PUBLIC_SAMPLE_PHOTOS_PER_STYLIST,
} from './public-sample-photos';

describe('fetchPublicSamplePhotos', () => {
  beforeEach(() => db.use.galleryRecord.findMany.mockReset());

  it('no accounts = no query', async () => {
    const result = await fetchPublicSamplePhotos([]);
    expect(result.size).toBe(0);
    expect(db.use.galleryRecord.findMany).not.toHaveBeenCalled();
  });

  it('one query, pinned and visible only, at most three per account in order', async () => {
    db.use.galleryRecord.findMany.mockResolvedValue([
      { created_by_account_id: 'a', asset_url: 'a1' },
      { created_by_account_id: 'b', asset_url: 'b1' },
      { created_by_account_id: 'a', asset_url: 'a2' },
      { created_by_account_id: 'a', asset_url: 'a3' },
      { created_by_account_id: 'a', asset_url: 'a4' },
    ]);
    const result = await fetchPublicSamplePhotos(['a', 'b', 'c']);
    expect(db.use.galleryRecord.findMany).toHaveBeenCalledTimes(1);
    const args = db.use.galleryRecord.findMany.mock.calls[0]?.[0];
    expect(args.where).toMatchObject({
      created_by_account_id: { in: ['a', 'b', 'c'] },
      is_pinned: true,
      is_hidden: false,
    });
    expect(args.take).toBeGreaterThan(0);
    // The stylist's chosen order first, unpositioned pins after (newest first).
    expect(args.orderBy).toEqual([
      { pinned_position: { sort: 'asc', nulls: 'last' } },
      { created_at: 'desc' },
      { gallery_record_id: 'desc' },
    ]);
    expect(result.get('a')).toEqual(['a1', 'a2', 'a3']);
    expect(result.get('a')).toHaveLength(PUBLIC_SAMPLE_PHOTOS_PER_STYLIST);
    expect(result.get('b')).toEqual(['b1']);
    expect(result.get('c')).toBeUndefined();
  });
});
