/**
 * Demo salon profile (ensureDemoSalonProfile_IO): the seed fills only empty
 * fields, does not take another salon's address, and creates the showcase
 * only when the salon has no work in it. Without that, LP screenshots of the
 * stylist panel showed „Dokończ konfigurację salonu”.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

type Owner = {
  salon_profile_name: string | null;
  salon_vanity_url: string | null;
  salon_brand_accent_color: string | null;
};

const { state, db } = vi.hoisted(() => {
  const state = {
    owner: null as Owner | null,
    slugHolder: null as { account_id: string } | null,
    aliasHolder: null as { account_id: string } | null,
    showcase: [] as { salon_account_id: string; gallery_record_id: string }[],
    gallery: [] as { gallery_record_id: string; asset_url: string }[],
  };
  const db = {
    use: {
      $transaction: async (fn: (tx: unknown) => unknown): Promise<unknown> =>
        fn(db.use),
      $queryRaw: async () => [{ account_id: 'acc-ania' }],
      profileLinkAlias: { findUnique: vi.fn(async () => state.aliasHolder) },
      stylistAccount: {
        findUnique: vi.fn(async () => state.owner),
        findFirst: vi.fn(async () => state.slugHolder),
        update: vi.fn(async ({ data }: { data: Partial<Owner> }) => {
          state.owner = { ...(state.owner as Owner), ...data };
          return state.owner;
        }),
      },
      salonShowcaseWork: {
        count: vi.fn(async () => state.showcase.length),
        createMany: vi.fn(
          async ({
            data,
          }: {
            data: { salon_account_id: string; gallery_record_id: string }[];
          }) => {
            state.showcase.push(...data);
            return { count: data.length };
          }
        ),
      },
      galleryRecord: {
        findMany: vi.fn(
          async ({ where }: { where: { asset_url: { in: string[] } } }) =>
            state.gallery.filter(row =>
              where.asset_url.in.includes(row.asset_url)
            )
        ),
      },
    },
  };
  return { state, db };
});

vi.mock('@app/db/db.client', () => ({ DB_CLIENT: db }));

import { ensureDemoSalonProfile_IO } from './demo-content-seeding.stylists';
import { DEMO_SALON_PROFILE } from './demo-content-seeding.config';

const OWNER = 'acc-ania';

beforeEach(() => {
  vi.clearAllMocks();
  state.owner = {
    salon_profile_name: null,
    salon_vanity_url: null,
    salon_brand_accent_color: null,
  };
  state.slugHolder = null;
  state.aliasHolder = null;
  state.showcase = [];
  state.gallery = [
    ...DEMO_SALON_PROFILE.showcase_asset_urls.map((asset_url, i) => ({
      gallery_record_id: `work-${i}`,
      asset_url,
    })),
    {
      gallery_record_id: 'work-other',
      asset_url: 'https://example.com/x.webp',
    },
  ];
});

describe('ensureDemoSalonProfile_IO', () => {
  it('pusty salon dostaje nazwę firmy, adres, kolor i trzy prace w witrynie', async () => {
    const results: string[] = [];
    await ensureDemoSalonProfile_IO({ ownerAccountId: OWNER, results });

    expect(state.owner).toEqual({
      salon_profile_name: 'Studio Velvet Nails',
      salon_vanity_url: 'studio-velvet-nails',
      salon_brand_accent_color: DEMO_SALON_PROFILE.salon_brand_accent_color,
    });
    expect(state.showcase.map(w => w.gallery_record_id)).toEqual([
      'work-0',
      'work-1',
      'work-2',
    ]);
    expect(DEMO_SALON_PROFILE.showcase_asset_urls).toHaveLength(3);
  });

  it('nie nadpisuje ręcznej konfiguracji ani istniejącej witryny', async () => {
    state.owner = {
      salon_profile_name: 'Moja nazwa',
      salon_vanity_url: 'moj-salon',
      salon_brand_accent_color: '#3A3F45',
    };
    state.showcase = [
      { salon_account_id: OWNER, gallery_record_id: 'work-chosen' },
    ];
    const results: string[] = [];
    await ensureDemoSalonProfile_IO({ ownerAccountId: OWNER, results });

    expect(db.use.stylistAccount.update).not.toHaveBeenCalled();
    expect(db.use.salonShowcaseWork.createMany).not.toHaveBeenCalled();
    expect(results).toEqual([]);
  });

  it('nie zabiera adresu salonu, który ma już inne konto', async () => {
    state.slugHolder = { account_id: 'acc-someone-else' };
    await ensureDemoSalonProfile_IO({ ownerAccountId: OWNER, results: [] });

    expect(state.owner?.salon_vanity_url).toBeNull();
    expect(state.owner?.salon_profile_name).toBe('Studio Velvet Nails');
  });

  it('does not use another salon’s retired address', async () => {
    state.aliasHolder = { account_id: 'another-salon' };
    await ensureDemoSalonProfile_IO({ ownerAccountId: OWNER, results: [] });
    expect(state.owner?.salon_vanity_url).toBeNull();
  });
});
