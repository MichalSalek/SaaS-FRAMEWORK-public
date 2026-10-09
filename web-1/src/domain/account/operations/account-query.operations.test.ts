/**
 * getStylistsWithLocation_IO — the radius filter must not be an exact-location
 * oracle. The response rounds coordinates to ~110 m, so result membership has to
 * be computed from those same rounded coordinates: a tiny radius centered on the
 * stored (exact) address must NOT match, while one centered on the public pin must.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { db } = vi.hoisted(() => ({
  db: {
    use: {
      stylistAccount: { findMany: vi.fn() },
      galleryRecord: { groupBy: vi.fn() },
    },
  },
}));

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));
vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

import { getStylistsWithLocation_IO } from './account-query.operations';

const EXACT_LAT = 52.2297123;
const EXACT_LON = 21.0122456;
const PIN_LAT = 52.23;
const PIN_LON = 21.012;

const stylistRow = {
  account_id: 'sa_1',
  business_name: 'Studio',
  address_city: 'Warszawa',
  display_name: 'Ala',
  latitude: EXACT_LAT,
  longitude: EXACT_LON,
  created_by_user: { name: 'Ala' },
  pricing_plan: 'FREE',
};

describe('getStylistsWithLocation_IO — radius filter on rounded coordinates', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.use.stylistAccount.findMany.mockResolvedValue([stylistRow]);
    db.use.galleryRecord.groupBy.mockResolvedValue([
      { created_by_account_id: 'sa_1', _count: { _all: 2 } },
    ]);
  });

  it('a 1 m radius on the exact stored address does not match', async () => {
    const result = await getStylistsWithLocation_IO({
      latitude: EXACT_LAT,
      longitude: EXACT_LON,
      radiusKm: 0.001,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toEqual([]);
    }
  });

  it('a 1 m radius on the public pin matches, and only the pin is emitted', async () => {
    const result = await getStylistsWithLocation_IO({
      latitude: PIN_LAT,
      longitude: PIN_LON,
      radiusKm: 0.001,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toHaveLength(1);
      expect(result.data[0]).toEqual(
        expect.objectContaining({ latitude: PIN_LAT, longitude: PIN_LON })
      );
    }
  });

  it('a normal search radius around the exact address still finds the stylist', async () => {
    const result = await getStylistsWithLocation_IO({
      latitude: EXACT_LAT,
      longitude: EXACT_LON,
      radiusKm: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.map(stylist => stylist.account_id)).toEqual(['sa_1']);
    }
  });
});

describe('getStylistsWithLocation_IO — gallery_count = prace widoczne publicznie', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    db.use.stylistAccount.findMany.mockResolvedValue([stylistRow]);
  });

  it('liczy nieukryte prace jednym groupBy, bez sufitu planu (rozmiar portfolio)', async () => {
    // FREE po downgrade z 7 nieukrytymi pracami: publicznie 7 (profil pokaże 3 wyróżnione + 4 więcej).
    db.use.galleryRecord.groupBy.mockResolvedValue([
      { created_by_account_id: 'sa_1', _count: { _all: 7 } },
    ]);

    const result = await getStylistsWithLocation_IO({
      latitude: PIN_LAT,
      longitude: PIN_LON,
      radiusKm: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]?.gallery_count).toBe(7);
      expect(result.data[0]).not.toHaveProperty('pricing_plan');
    }
    expect(db.use.galleryRecord.groupBy).toHaveBeenCalledTimes(1);
    expect(db.use.galleryRecord.groupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          created_by_account_id: { in: ['sa_1'] },
          is_hidden: false,
        }),
      })
    );
  });

  it('konto bez nieukrytych prac ma 0, nie liczbę z cache', async () => {
    db.use.galleryRecord.groupBy.mockResolvedValue([]);

    const result = await getStylistsWithLocation_IO({
      latitude: PIN_LAT,
      longitude: PIN_LON,
      radiusKm: 10,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data[0]?.gallery_count).toBe(0);
    }
  });
});
