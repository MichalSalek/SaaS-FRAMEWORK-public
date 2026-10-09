/**
 * Gallery-public unit tests — publicGetGalleryRecordsByAccount_IO.
 *
 * Locks in the PUBLIC surface contract:
 *
 *  - account gate = full STYLIST_PUBLICLY_VISIBLE (account_status ACTIVE AND
 *    created_by_user.is_active) — a not-publicly-visible account returns the
 *    SAME ACCOUNT_NOT_FOUND as a missing one (anti-enumeration parity);
 *  - record WHERE: owner scoping + is_pinned:true (public shows pinned only) +
 *    is_hidden:false (moderation mask — hidden records never leak publicly);
 *  - the plan pin limit is the ONLY ceiling: it bounds take AND skip (a client
 *    cannot page past what the plan permits), and total_count is reported through
 *    the same ceiling — no `limit` means "the whole plan window", not a magic 24;
 *  - color/trait filters compile to AND (each id its own `some`);
 *  - FREE plan → show_watermark:true AND brand_accent_color masked to null at
 *    read-time (branding-light krok 2); paid plan → watermark off, color passes.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { publicGetGalleryRecordsByAccount_IO } from './gallery-public.operations';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';

const ACCOUNT_ID = 'acc_test_0000000000000001';
const CREATED_AT = new Date('2026-01-01T00:00:00.000Z');

const makeAccount = ({
  plan = PricingPlanValue.FREE as string,
  brandColor = null as string | null,
} = {}) => ({
  account_id: ACCOUNT_ID,
  display_name: 'Test Salon',
  business_name: null,
  address_city: 'Warszawa',
  pricing_plan: plan,
  brand_accent_color: brandColor,
});

const makeRecord = (id: string) => ({
  gallery_record_id: id,
  asset_url: `https://res.cloudinary.com/test/image/upload/v1/${id}.jpg`,
  nail_length: NAIL_LENGTHS.MEDIUM,
  created_at: CREATED_AT,
  colors: [{ color: { id: 'color_1', name: 'Red', hex_code: '#ff0000' } }],
  traits: [],
});

const mockScenario = ({
  account = makeAccount() as ReturnType<typeof makeAccount> | null,
  records = [makeRecord('gr_test_0000000000000001')],
  totalCount = 1,
} = {}) => {
  const findFirst = vi.fn(async (_arg: unknown) => account);
  const findMany = vi.fn(async (_arg: unknown) => records);
  const count = vi.fn(async (_arg: unknown) => totalCount);
  mockDb({
    stylistAccount: { findFirst },
    galleryRecord: { findMany, count },
  });
  return { findFirst, findMany, count };
};

describe('publicGetGalleryRecordsByAccount_IO — public pinned gallery', () => {
  it('account gate uses the FULL public-visibility pair; missing/not-visible → ACCOUNT_NOT_FOUND', async () => {
    const { findFirst, findMany } = mockScenario({ account: null });

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
    // The gate must carry BOTH halves of STYLIST_PUBLICLY_VISIBLE.
    const whereArg = findFirst.mock.calls[0]?.[0] as {
      where: {
        account_id: string;
        account_status: string;
        created_by_user: { is_active: boolean };
      };
    };
    expect(whereArg.where.account_id).toBe(ACCOUNT_ID);
    expect(whereArg.where.account_status).toBe(AccountStatusValue.ACTIVE);
    expect(whereArg.where.created_by_user).toEqual({ is_active: true });
    expect(findMany).not.toHaveBeenCalled();
  });

  it('record WHERE: owner scope + pinned-only + hidden mask; take capped at the PLAN pin limit; offset → skip', async () => {
    const { findMany, count } = mockScenario();

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID, limit: 50, offset: 1 },
    });

    expect(result.success).toBe(true);
    const findManyArg = findMany.mock.calls[0]?.[0] as {
      where: {
        created_by_account_id: string;
        is_pinned: boolean;
        is_hidden: boolean;
      };
      take: number;
      skip: number;
    };
    expect(findManyArg.where.created_by_account_id).toBe(ACCOUNT_ID);
    expect(findManyArg.where.is_pinned).toBe(true);
    // Moderation mask — hidden records NEVER leak on the public surface.
    expect(findManyArg.where.is_hidden).toBe(false);
    // Sufit publiczny = limit pinów z PLANU (FREE = 3), nie stałe 5:
    // stałe 5 unieważniało sprzedawaną drabinkę 3→10→15→30→50. Sufit obejmuje
    // CAŁE okno, więc po offsecie zostają już tylko 2 rekordy z dozwolonych 3.
    expect(findManyArg.take).toBe(2);
    expect(findManyArg.skip).toBe(1);
    // total_count uses the SAME masked where.
    const countArg = count.mock.calls[0]?.[0] as {
      where: { is_hidden: boolean; is_pinned: boolean };
    };
    expect(countArg.where.is_hidden).toBe(false);
    expect(countArg.where.is_pinned).toBe(true);
  });

  it('offset poza sufitem planu → pusta strona i ZERO zapytania o rekordy', async () => {
    const { findMany } = mockScenario({ totalCount: 12 });

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID, limit: 3, offset: 3 },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.records).toEqual([]);
    }
    // Sufit nie byłby sufitem, gdyby paginacja mogła obok niego przejść:
    // zmierzone przed poprawką — FREE (sufit 3), offset 0/3/6/9 → 12 z 12 rekordów.
    expect(findMany).not.toHaveBeenCalled();
  });

  it('total_count nie obiecuje więcej, niż endpoint odda (sufit planu)', async () => {
    mockScenario({ totalCount: 12 });

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      // FREE: 12 przypiętych zostało po downgrade, ale wizytówka poda tylko 3.
      expect(result.data.total_count).toBe(3);
    }
  });

  it('ułamkowy/ujemny limit nie dociera do Prismy (operacja broni się sama)', async () => {
    const { findMany } = mockScenario({
      account: makeAccount({ plan: PricingPlanValue.PRO }),
    });

    await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID, limit: 2.7, offset: 1.9 },
    });

    const findManyArg = findMany.mock.calls[0]?.[0] as {
      take: number;
      skip: number;
    };
    expect(findManyArg.take).toBe(2);
    expect(findManyArg.skip).toBe(1);
  });

  it('wyższy plan podnosi sufit publiczny (STUDIO = 30 przypiętych)', async () => {
    const { findMany } = mockScenario({
      account: makeAccount({ plan: PricingPlanValue.STUDIO }),
    });

    await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID, limit: 50 },
    });

    const findManyArg = findMany.mock.calls[0]?.[0] as { take: number };
    expect(findManyArg.take).toBe(30);
  });

  it('bez `limit` domyślną porcją JEST sufit planu (STUDIO = 30, nie stała 24)', async () => {
    const { findMany } = mockScenario({
      account: makeAccount({ plan: PricingPlanValue.STUDIO }),
    });

    await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID },
    });

    const findManyArg = findMany.mock.calls[0]?.[0] as { take: number };
    // Każda stała obok max_pinned_records jest drugą władzą nad tą samą drabinką
    // i rozjeżdża się z nią: dawne 24 ścinało STUDIO (30) i SCALE (50).
    expect(findManyArg.take).toBe(30);
  });

  it('SCALE (50) też jest osiągalne — najwyższy szczebel drabinki', async () => {
    const { findMany } = mockScenario({
      account: makeAccount({ plan: PricingPlanValue.SCALE }),
    });

    await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID, limit: 100 },
    });

    const findManyArg = findMany.mock.calls[0]?.[0] as { take: number };
    expect(findManyArg.take).toBe(50);
  });

  it('color/trait filters compile to AND — one `some` per id', async () => {
    const { findMany } = mockScenario();

    await publicGetGalleryRecordsByAccount_IO({
      props: {
        account_id: ACCOUNT_ID,
        color_ids: ['color_1', 'color_2'],
        trait_ids: ['trait_1'],
      },
    });

    const findManyArg = findMany.mock.calls[0]?.[0] as {
      where: { AND: Array<Record<string, unknown>> };
    };
    expect(findManyArg.where.AND).toHaveLength(3);
    expect(findManyArg.where.AND[0]).toEqual({
      colors: { some: { color_id: 'color_1' } },
    });
    expect(findManyArg.where.AND[2]).toEqual({
      traits: { some: { trait_id: 'trait_1' } },
    });
  });

  it('FREE plan: show_watermark=true and brand_accent_color masked to null at read-time', async () => {
    mockScenario({
      account: makeAccount({
        plan: PricingPlanValue.FREE,
        brandColor: '#ff0000',
      }),
    });

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.show_watermark).toBe(true);
      // Column still holds a value (write-gate does not clear on downgrade) —
      // the READ masks it for plans without can_brand_profile.
      expect(result.data.stylist_info.brand_accent_color).toBeNull();
    }
  });

  it('paid plan (PRO_PLUS): no watermark, brand_accent_color passes through, records mapped', async () => {
    mockScenario({
      account: makeAccount({
        plan: PricingPlanValue.PRO_PLUS,
        brandColor: '#123456',
      }),
      totalCount: 7,
    });

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID },
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.show_watermark).toBe(false);
      expect(result.data.stylist_info.brand_accent_color).toBe('#123456');
      expect(result.data.total_count).toBe(7);
      expect(result.data.records).toHaveLength(1);
      expect(result.data.records[0]?.colors).toEqual([
        { id: 'color_1', name: 'Red', hex_code: '#ff0000' },
      ]);
      expect(result.data.records[0]?.nail_length).toBe(NAIL_LENGTHS.MEDIUM);
    }
  });

  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      stylistAccount: {
        findFirst: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await publicGetGalleryRecordsByAccount_IO({
      props: { account_id: ACCOUNT_ID },
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});
