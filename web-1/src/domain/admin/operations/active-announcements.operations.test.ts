import { beforeEach, describe, expect, it, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { getActiveAnnouncements_IO } from './active-announcements.operations';
import {
  ANNOUNCEMENT_CACHE_KEY,
  announcementCache,
} from './admin-announcements.helpers';

const row = {
  id: 'private',
  title: 'Private',
  message: 'Stylist news',
  type: 'info',
  audience_anonymous: false,
  audience_client: false,
  audience_stylist: true,
  translations: { pl: { title: 'Private', message: 'Stylist news' } },
  starts_at: null,
  ends_at: null,
};

beforeEach(() => announcementCache.invalidate(ANNOUNCEMENT_CACHE_KEY));

describe('active announcement cache isolation', () => {
  it('invalidates the same cache from separately bundled API modules', async () => {
    announcementCache.set(ANNOUNCEMENT_CACHE_KEY, []);
    vi.resetModules();
    const otherBundle = await import('./admin-announcements.helpers');
    otherBundle.announcementCache.invalidate(ANNOUNCEMENT_CACHE_KEY);
    expect(announcementCache.get(ANNOUNCEMENT_CACHE_KEY)).toBeNull();
  });
  it('filters every cache read, so a stylist cache fill cannot leak content to an anonymous caller', async () => {
    const findMany = vi.fn(async () => [row]);
    mockDb({ announcement: { findMany } });
    const stylist = await getActiveAnnouncements_IO({
      viewer: 'STYLIST',
      surface: 'app',
    });
    expect(stylist.success && stylist.data.map(item => item.id)).toEqual([
      'private',
    ]);
    for (const params of [
      { viewer: null, surface: 'public' },
      { viewer: 'CLIENT', surface: 'app' },
      { viewer: 'STYLIST', surface: 'public' },
    ] as const) {
      const result = await getActiveAnnouncements_IO(params);
      expect(result.success && result.data).toEqual([]);
    }
    expect(findMany).toHaveBeenCalledTimes(1);
  });
  it('respects time windows independently from the cached audience set', async () => {
    mockDb({
      announcement: {
        findMany: async () => [{ ...row, ends_at: new Date('2000-01-01') }],
      },
    });
    const result = await getActiveAnnouncements_IO({
      viewer: 'STYLIST',
      surface: 'app',
    });
    expect(result.success && result.data).toEqual([]);
  });
});
