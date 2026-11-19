import { afterEach, describe, expect, it, vi } from 'vitest';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { sessionStylistRelationshipWhere } from '../session-activity.access';

const mocks = vi.hoisted(() => ({
  sessionCount: vi.fn(async (_args: unknown) => 2),
  photoCount: vi.fn(async (_args: unknown) => 5),
  photoFindMany: vi.fn(async (_args: unknown) => [
    { gallery_record_id: 'g1' },
    { gallery_record_id: 'g2' },
    { gallery_record_id: 'g1' },
  ]),
  colorGroupBy: vi.fn(async (_args: unknown) => [
    { color_id: 'c1', _count: { color_id: 2 } },
  ]),
  traitGroupBy: vi.fn(async (_args: unknown) => [
    { trait_id: 't1', _count: { trait_id: 2 } },
  ]),
  recordGroupBy: vi.fn(async (_args: unknown) => [
    { nail_length: 'LONG', _count: { nail_length: 2 } },
  ]),
  colorFindMany: vi.fn(async (_args: unknown) => [
    { id: 'c1', name: 'Różowe', hex_code: '#ff69b4' },
  ]),
  traitFindMany: vi.fn(async (_args: unknown) => [
    { id: 't1', name: 'French' },
  ]),
}));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      sessionContainer: { count: mocks.sessionCount },
      sessionContainerPhoto: {
        count: mocks.photoCount,
        findMany: mocks.photoFindMany,
      },
      galleryRecordColor: { groupBy: mocks.colorGroupBy },
      galleryRecordTrait: { groupBy: mocks.traitGroupBy },
      galleryRecord: { groupBy: mocks.recordGroupBy },
      color: { findMany: mocks.colorFindMany },
      trait: { findMany: mocks.traitFindMany },
    },
  },
}));

import { getSessionInsights_IO } from './session-insights.operations';

afterEach(() => vi.clearAllMocks());

describe('session insights', () => {
  const readableSession = {
    stylist_account_id: 'stylist',
    shared_at: { not: null },
    lifecycle_state: { notIn: ['DRAFT', 'READY'] },
    client_account: { created_by_user: { is_active: true } },
    AND: [sessionStylistRelationshipWhere('stylist')],
  };

  it('Free Demo sees the counters and an upsell, never the tags', async () => {
    const result = await getSessionInsights_IO({
      stylist_account_id: 'stylist',
      pricing_plan: PricingPlanValue.FREE,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data).toMatchObject({
      available: false,
      sessions_count: 2,
      photos_count: 5,
      top_colors: [],
      top_traits: [],
      top_lengths: [],
    });
    expect(mocks.photoFindMany).not.toHaveBeenCalled();
    expect(mocks.colorGroupBy).not.toHaveBeenCalled();
    expect(mocks.sessionCount).toHaveBeenCalledWith({
      where: { ...readableSession, photos: { some: {} } },
    });
    expect(mocks.photoCount).toHaveBeenCalledWith({
      where: { session: readableSession },
    });
  });

  it('a paid plan aggregates the top tags and de-duplicates records', async () => {
    const result = await getSessionInsights_IO({
      stylist_account_id: 'stylist',
      pricing_plan: PricingPlanValue.PRO,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.available).toBe(true);
    expect(result.data.top_colors).toEqual([
      { name: 'Różowe', hex_code: '#ff69b4', count: 2 },
    ]);
    expect(result.data.top_traits).toEqual([{ name: 'French', count: 2 }]);
    expect(result.data.top_lengths).toEqual([{ length: 'LONG', count: 2 }]);
    expect(mocks.photoFindMany).toHaveBeenCalledWith({
      where: { session: readableSession },
      select: { gallery_record_id: true },
      orderBy: { created_at: 'desc' },
      take: 5000,
    });
    expect(mocks.colorGroupBy).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { gallery_record_id: { in: ['g1', 'g2'] } },
        take: 3,
      })
    );
  });
});
