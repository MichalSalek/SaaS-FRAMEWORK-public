/**
 * Publiczna liczba prac = rozmiar portfolio: nieukryte prace liczone z bazy, bez
 * filtra przypięcia i bez sufitu planu (profil mówi „Wyróżnione (N) + jeszcze M
 * w pełnej galerii”). Suita pinuje helper, listę publiczną i zapisane stylistki.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    use: {
      galleryRecord: { groupBy: vi.fn(), count: vi.fn() },
      stylistAccount: { findMany: vi.fn(), findUnique: vi.fn() },
      favoriteStylist: { findMany: vi.fn() },
      clientStylistPair: { findMany: vi.fn() },
    },
  },
}));

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import {
  countPublicGalleryRecords,
  countPublicGalleryRecordsByAccount,
  resolvePublicGalleryCeiling,
} from './public-gallery-count';
import { getPublicStylistsList_IO } from '@domain/public/operations/public-stylists-list.operations';
import { getBookmarkedStylists_IO } from '@domain/favorites/operations/bookmarked-stylists.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

beforeEach(() => {
  vi.clearAllMocks();
});

describe('resolvePublicGalleryCeiling', () => {
  it('= limit pinów z planu (3 → 10 → 15 → 30 → 50)', () => {
    expect(resolvePublicGalleryCeiling(PricingPlanValue.FREE)).toBe(3);
    expect(resolvePublicGalleryCeiling(PricingPlanValue.PRO)).toBe(10);
    expect(resolvePublicGalleryCeiling(PricingPlanValue.SCALE)).toBe(50);
  });
});

describe('countPublicGalleryRecordsByAccount', () => {
  it('jeden groupBy dla wielu kont, nieukryte prace bez sufitu planu, brak prac = 0', async () => {
    db.use.galleryRecord.groupBy.mockResolvedValue([
      { created_by_account_id: 'sa_free', _count: { _all: 8 } },
      { created_by_account_id: 'sa_pro', _count: { _all: 4 } },
    ]);

    const counts = await countPublicGalleryRecordsByAccount([
      { account_id: 'sa_free' },
      { account_id: 'sa_pro' },
      { account_id: 'sa_empty' },
    ]);

    expect(db.use.galleryRecord.groupBy).toHaveBeenCalledTimes(1);
    expect(db.use.galleryRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        by: ['created_by_account_id'],
        where: {
          created_by_account_id: { in: ['sa_free', 'sa_pro', 'sa_empty'] },
          is_hidden: false,
        },
      })
    );
    // FREE with 8 works shows 3 featured + "5 more in the full gallery": 8 is true.
    expect(counts.get('sa_free')).toBe(8);
    expect(counts.get('sa_pro')).toBe(4);
    expect(counts.get('sa_empty')).toBe(0);
  });

  it('pusta lista kont nie pyta bazy', async () => {
    const counts = await countPublicGalleryRecordsByAccount([]);
    expect(counts.size).toBe(0);
    expect(db.use.galleryRecord.groupBy).not.toHaveBeenCalled();
  });

  it('wariant pojedynczy liczy ten sam zbiór', async () => {
    db.use.galleryRecord.count.mockResolvedValue(20);
    await expect(
      countPublicGalleryRecords({ account_id: 'sa_1' })
    ).resolves.toBe(20);
    expect(db.use.galleryRecord.count).toHaveBeenCalledWith({
      where: { created_by_account_id: 'sa_1', is_hidden: false },
    });
  });
});

describe('GET stylist/get-public-list — photo_count', () => {
  it('photo_count = prace widoczne publicznie, nie cached_gallery_count', async () => {
    db.use.stylistAccount.findMany.mockResolvedValue([
      {
        account_id: 'sa_1',
        display_name: 'Ala',
        avatar_url: null,
        created_by_user: { image: null },
        address_city: 'Kraków',
        instagram_handle: null,
        vanity_url: null,
        pricing_plan: PricingPlanValue.FREE,
        brand_accent_color: null,
        cached_bookmark_count: 1,
        // Pole z całą galerią nie jest już wybierane — gdyby wróciło, test to złapie.
        cached_gallery_count: 99,
      },
    ]);
    db.use.galleryRecord.groupBy.mockResolvedValue([
      { created_by_account_id: 'sa_1', _count: { _all: 2 } },
    ]);

    const result = await getPublicStylistsList_IO({ take: 20 });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.stylists[0]?.photo_count).toBe(2);
    }
    const select = db.use.stylistAccount.findMany.mock.calls[0]?.[0]?.select;
    expect(select).not.toHaveProperty('cached_gallery_count');
  });
});

describe('GET favorites/get-bookmarked-stylists — gallery_count', () => {
  it('ta sama liczba publiczna dla każdej zapisanej stylistki, świeża zamiast z cache', async () => {
    const stylist = () => ({
      business_name: null,
      address_city: null,
      display_name: 'S',
      created_by_user: { name: 'S' },
    });
    db.use.favoriteStylist.findMany.mockResolvedValue([
      {
        id: 'fav_paired',
        stylist_account_id: 'sa_paired',
        created_at: new Date('2026-09-01T00:00:00Z'),
        stylist: stylist(),
      },
      {
        id: 'fav_unpaired',
        stylist_account_id: 'sa_unpaired',
        created_at: new Date('2026-09-01T00:00:00Z'),
        stylist: stylist(),
      },
    ]);
    db.use.clientStylistPair.findMany.mockResolvedValue([
      { stylist_account_id: 'sa_paired' },
    ]);
    db.use.galleryRecord.groupBy.mockResolvedValue([
      { created_by_account_id: 'sa_paired', _count: { _all: 12 } },
      { created_by_account_id: 'sa_unpaired', _count: { _all: 5 } },
    ]);

    const result = await getBookmarkedStylists_IO({ id: 'usr_client' });

    expect(result.success).toBe(true);
    if (result.success) {
      const byId = new Map(
        result.data.records.map(r => [r.stylist_account_id, r.gallery_count])
      );
      expect(byId.get('sa_paired')).toBe(12);
      expect(byId.get('sa_unpaired')).toBe(5);
    }
  });
});
