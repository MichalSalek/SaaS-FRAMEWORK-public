import { activeSalonMembershipFixture } from '../../../test-utils/salon-plan.fixture';
/**
 * createGalleryRecord_IO via the mockDb proxy. Create and the gallery-count
 * increment share one transaction; Cloudinary cleanup runs only when a failure
 * leaves an already-uploaded asset_url. The plan quota blocks at the limit
 * (an unlimited plan skips the post-create recount). A recount that sees a
 * concurrent winner rolls back as GALLERY_LIMIT_REACHED, not DATABASE_ERROR.
 * Bad color or trait ids fail before the transaction; P2003 on the junction
 * create is VALIDATION_ERROR. A missing stylist account is ACCOUNT_NOT_FOUND.
 */

import { describe, it, expect, vi } from 'vitest';
import {
  assetOwnershipStubs,
  mockDb,
} from '../../../test-utils/mockApiHandler';
import { createGalleryRecord_IO } from './gallery-create.operation';
import { cleanupCloudinaryAsset } from './gallery-cloudinary-cleanup';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

vi.mock('./gallery-cloudinary-cleanup', () => ({
  cleanupCloudinaryAsset: vi.fn(),
  cleanupCloudinaryAssets: vi.fn(),
}));

const ACCOUNT_ID = 'acc_test_0000000000000001';
const OP_ID = 'op_test_0000000000000001';
const ASSET_URL =
  'https://res.cloudinary.com/test/image/upload/v1/nailfolio/new-photo.jpg';

// Cast-bridge for top-level raw-SQL stubs in mockDb (per-model typed) — pattern:
// visit-record.operations.test.ts / session-container-add-photo.test.ts.
type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const makeArgs = (
  overrides: Partial<{
    asset_url: string;
    color_ids: string[];
    trait_ids: string[];
  }> = {}
) => ({
  props: {
    created_by_account_id: ACCOUNT_ID,
    asset_url: ASSET_URL,
    color_ids: ['color_1'],
    trait_ids: ['trait_1'],
    nail_length: NAIL_LENGTHS.MEDIUM,
    ...overrides,
  },
  id: OP_ID,
});

/** Standard model set for the happy/most paths — override per scenario. */
const mockScenario = ({
  plan = PricingPlanValue.FREE as string,
  counts = [0, 1] as number[],
  salonPlan = null as null | 'STUDIO' | 'SCALE',
  colorIds = ['color_1'] as string[],
  traitIds = ['trait_1'] as string[],
  // The file-ownership gate asks three tables for another account's row with the
  // same public_id. 'OWN' means nobody else has it.
  assetOwner = 'OWN' as 'OWN' | 'FOREIGN',
} = {}) => {
  const count = vi.fn(async () => 0);
  for (const value of counts) {
    count.mockResolvedValueOnce(value);
  }
  const create = vi.fn(async (_arg: unknown) => ({
    gallery_record_id: 'gr_created_0000000001',
    created_by_account_id: ACCOUNT_ID,
    asset_url: ASSET_URL,
  }));
  const executeRaw = vi.fn(async () => 1);
  const ownership = assetOwnershipStubs(
    assetOwner === 'FOREIGN' ? { id: 'gr_foreign_0000000001' } : null
  );
  mockDb({
    staffMember: {
      findMany: async () => activeSalonMembershipFixture(salonPlan),
    },
    ...ownership,
    stylistAccount: {
      ...ownership.stylistAccount,
      findUnique: vi.fn(async () => ({
        pricing_plan: plan,
        created_by_user_id: 'member',
      })),
    },
    color: {
      findMany: vi.fn(async () => colorIds.map(id => ({ id }))),
    },
    trait: {
      findMany: vi.fn(async () => traitIds.map(id => ({ id }))),
    },
    galleryRecord: { ...ownership.galleryRecord, count, create },
    $executeRaw: rawStub(executeRaw),
  });
  return { count, create, executeRaw };
};

describe('createGalleryRecord_IO — create + quota + curation + B14 cleanup', () => {
  it('accepted member on own Free creates above the Free cap using salon capabilities', async () => {
    const { create } = mockScenario({
      plan: PricingPlanValue.FREE,
      salonPlan: 'STUDIO',
      counts: [100],
    });
    const result = await createGalleryRecord_IO(makeArgs());
    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledOnce();
  });

  it('happy path (FREE, count<limit): create with junction rows + gallery-count increment in the same tx, no cleanup', async () => {
    const { count, create, executeRaw } = mockScenario({ counts: [0, 1] });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.gallery_record_id).toBe('gr_created_0000000001');
    }

    // Create payload: owner scoping + nested junction creates from the input ids.
    expect(create).toHaveBeenCalledTimes(1);
    const createArg = create.mock.calls[0]?.[0] as {
      data: {
        created_by_account_id: string;
        asset_url: string;
        nail_length: string;
        colors: { create: Array<{ color_id: string }> };
        traits: { create: Array<{ trait_id: string }> };
      };
    };
    expect(createArg.data.created_by_account_id).toBe(ACCOUNT_ID);
    expect(createArg.data.asset_url).toBe(ASSET_URL);
    expect(createArg.data.nail_length).toBe(NAIL_LENGTHS.MEDIUM);
    expect(createArg.data.colors.create).toEqual([{ color_id: 'color_1' }]);
    expect(createArg.data.traits.create).toEqual([{ trait_id: 'trait_1' }]);

    // incrementGalleryCount: single raw UPDATE on cached_gallery_count, by=1, this account.
    expect(executeRaw).toHaveBeenCalledTimes(1);
    const rawCall = executeRaw.mock.calls[0] as unknown as [
      readonly string[],
      number,
      string,
    ];
    expect(rawCall[0].join('')).toContain('cached_gallery_count');
    expect(rawCall[1]).toBe(1);
    expect(rawCall[2]).toBe(ACCOUNT_ID);

    // FREE (limit 5 !== -1) → pre-check + post-create verify = 2 counts.
    expect(count).toHaveBeenCalledTimes(2);

    // Success → asset stays in Cloudinary.
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('cudzy asset_url → VALIDATION_ERROR na asset_url, create NIGDY nie rusza', async () => {
    // Regression: gallery was the third surface that accepted a file URL from the
    // client and the only one without an ownership gate. A work copied from
    // someone else's public profile could be inserted, and the sink then refused
    // to delete the victim file because the attacker's row still referenced it.
    const { count, create } = mockScenario({ assetOwner: 'FOREIGN' });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('asset_url');
      }
    }
    // Rejected before any work: no quota read, no transaction, no insert.
    expect(count).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('FREE at limit (count=5) → GALLERY_LIMIT_REACHED, create NEVER runs, cleanup fires', async () => {
    const { create, executeRaw } = mockScenario({ counts: [5] });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('GALLERY_LIMIT_REACHED');
      if (result.error.type === 'GALLERY_LIMIT_REACHED') {
        expect(result.error.currentCount).toBe(5);
        expect(result.error.limit).toBe(5);
        expect(result.error.planType).toBe(PricingPlanValue.FREE);
      }
    }
    expect(create).not.toHaveBeenCalled();
    expect(executeRaw).not.toHaveBeenCalled();
    // Asset was uploaded client-side BEFORE this call — quota failure must orphan-clean it.
    expect(cleanupCloudinaryAsset).toHaveBeenCalledTimes(1);
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('unlimited plan (PRO, limit -1): creates despite huge count and SKIPS the post-create verify', async () => {
    const { count, create } = mockScenario({
      plan: PricingPlanValue.PRO,
      counts: [5000],
    });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(true);
    expect(create).toHaveBeenCalledTimes(1);
    // limit === -1 → no recount after create (only the pre-check count).
    expect(count).toHaveBeenCalledTimes(1);
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });

  it('POST-CREATE VERIFY race: pre-check passes (4<5) but recount sees 6 → rollback → GALLERY_LIMIT_REACHED', async () => {
    const { create } = mockScenario({ counts: [4, 6] });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(false);
    if (!result.success) {
      // Race maps to the QUOTA error, NOT DATABASE_ERROR — the sentinel throw is
      // classified in the outer catch.
      expect(result.error.type).toBe('GALLERY_LIMIT_REACHED');
    }
    // The create DID run inside the tx (the race is detected only afterwards).
    expect(create).toHaveBeenCalledTimes(1);
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('curation gate: inactive/non-existent color_id → VALIDATION_ERROR before the tx (no create)', async () => {
    const { create } = mockScenario({
      // Input asks for color_1 + color_retired; dictionary confirms only color_1.
      colorIds: ['color_1'],
    });

    const result = await createGalleryRecord_IO(
      makeArgs({ color_ids: ['color_1', 'color_retired'] })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('color_ids');
      }
    }
    expect(create).not.toHaveBeenCalled();
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('curation gate: inactive/non-existent trait_id → VALIDATION_ERROR (field trait_ids), no create', async () => {
    const { create } = mockScenario({ traitIds: [] });

    const result = await createGalleryRecord_IO(
      makeArgs({ trait_ids: ['trait_retired'] })
    );

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('trait_ids');
      }
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('deduplicates color/trait ids: dictionary check and junction create see the deduped set', async () => {
    const colorFindMany = vi.fn(async (_arg: unknown) => [{ id: 'color_1' }]);
    const traitFindMany = vi.fn(async (_arg: unknown) => [{ id: 'trait_1' }]);
    const create = vi.fn(async (_arg: unknown) => ({
      gallery_record_id: 'gr_created_0000000002',
    }));
    const count = vi.fn(async () => 0);
    count.mockResolvedValueOnce(0).mockResolvedValueOnce(1);
    const ownership = assetOwnershipStubs();
    mockDb({
      staffMember: { findMany: async () => [] },
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: vi.fn(async () => ({
          pricing_plan: PricingPlanValue.FREE,
          created_by_user_id: 'member',
        })),
      },
      color: { findMany: colorFindMany },
      trait: { findMany: traitFindMany },
      galleryRecord: { ...ownership.galleryRecord, count, create },
      $executeRaw: rawStub(vi.fn(async () => 1)),
    });

    const result = await createGalleryRecord_IO(
      makeArgs({
        color_ids: ['color_1', 'color_1'],
        trait_ids: ['trait_1', 'trait_1', 'trait_1'],
      })
    );

    expect(result.success).toBe(true);
    // Dictionary lookups get the DEDUPED id set (length parity check would
    // otherwise false-fail on duplicates).
    const colorWhere = colorFindMany.mock.calls[0]?.[0] as unknown as {
      where: { id: { in: string[] } };
    };
    expect(colorWhere.where.id.in).toEqual(['color_1']);
    const traitWhere = traitFindMany.mock.calls[0]?.[0] as unknown as {
      where: { id: { in: string[] } };
    };
    expect(traitWhere.where.id.in).toEqual(['trait_1']);
    // Junction create: single row per unique id — no unique-constraint violation.
    const createArg = create.mock.calls[0]?.[0] as {
      data: {
        colors: { create: Array<{ color_id: string }> };
        traits: { create: Array<{ trait_id: string }> };
      };
    };
    expect(createArg.data.colors.create).toEqual([{ color_id: 'color_1' }]);
    expect(createArg.data.traits.create).toEqual([{ trait_id: 'trait_1' }]);
  });

  it('account not found → ACCOUNT_NOT_FOUND + cleanup', async () => {
    const ownership = assetOwnershipStubs();
    mockDb({
      staffMember: { findMany: async () => [] },
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: vi.fn(async () => null),
      },
    });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('ACCOUNT_NOT_FOUND');
    }
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('P2003 on nested junction create (TOCTOU delete) → VALIDATION_ERROR, not DATABASE_ERROR', async () => {
    const count = vi.fn(async () => 0);
    const ownership = assetOwnershipStubs();
    mockDb({
      staffMember: { findMany: async () => [] },
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: vi.fn(async () => ({
          pricing_plan: PricingPlanValue.FREE,
          created_by_user_id: 'member',
        })),
      },
      color: { findMany: vi.fn(async () => [{ id: 'color_1' }]) },
      trait: { findMany: vi.fn(async () => [{ id: 'trait_1' }]) },
      galleryRecord: {
        ...ownership.galleryRecord,
        count,
        create: vi.fn(async () => {
          throw Object.assign(new Error('FK violation'), { code: 'P2003' });
        }),
      },
      $executeRaw: rawStub(vi.fn(async () => 1)),
    });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
      if (result.error.type === 'VALIDATION_ERROR') {
        expect(result.error.field).toBe('color_ids/trait_ids');
      }
    }
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('unknown DB throw inside tx → DATABASE_ERROR + cleanup', async () => {
    const ownership = assetOwnershipStubs();
    mockDb({
      staffMember: { findMany: async () => [] },
      ...ownership,
      stylistAccount: {
        ...ownership.stylistAccount,
        findUnique: vi.fn(async () => ({
          pricing_plan: PricingPlanValue.FREE,
          created_by_user_id: 'member',
        })),
      },
      color: { findMany: vi.fn(async () => [{ id: 'color_1' }]) },
      trait: { findMany: vi.fn(async () => [{ id: 'trait_1' }]) },
      galleryRecord: {
        ...ownership.galleryRecord,
        count: vi.fn(async () => 0),
        create: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
      $executeRaw: rawStub(vi.fn(async () => 1)),
    });

    const result = await createGalleryRecord_IO(makeArgs());

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
    expect(cleanupCloudinaryAsset).toHaveBeenCalledWith(ASSET_URL);
  });

  it('missing asset_url → VALIDATION_ERROR and NO cleanup (nothing was uploaded)', async () => {
    mockDb({});

    const result = await createGalleryRecord_IO(makeArgs({ asset_url: '' }));

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('VALIDATION_ERROR');
    }
    expect(cleanupCloudinaryAsset).not.toHaveBeenCalled();
  });
});
