import { resolveEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../../prisma/js-client';
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PRICING_POLICY,
  narrowPricingPlan,
} from '@kernel/policies/pricing.policy';
import type { GALLERY_DTO_API_V1 } from '@kernel/models/gallery/gallery.dto';
import type { ContractHandlerResponse } from '@kernel/application/contracts/contract.types';
import type { GalleryContracts } from '@kernel/domain/gallery/gallery.contracts';

type GalleryHandlerData<K extends keyof GalleryContracts> =
  ContractHandlerResponse<GalleryContracts[K]>;
import {
  assertType,
  isNailLengthNarrower,
} from '@kernel/models/type_narrowing';
import {
  GALLERY_COLORS_TRAITS_SELECT,
  mapGalleryColors,
  mapGalleryTraits,
} from '@domain/gallery/gallery.utils.api';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  PINNED_GALLERY_RECORD_ORDER_BY,
  VISIBLE_PINNED_GALLERY_RECORD_WHERE,
} from '@domain/gallery/gallery-record-visibility';
import { resolvePublicGalleryCeiling } from '@domain/gallery/public-gallery-count';

// DECISION: there is no second number next to the plan ceiling. A constant DEFAULT_PUBLIC_GALLERY_TAKE = 24
// used to cap STUDIO (30) and SCALE (50) at 24, the same bug as the old hard 5 in the handler. Any number next
// to PRICING_LIMITS_SSOT.max_pinned_records is a second authority over the sold 3->10->15->30->50 ladder and
// will drift, so the default page size IS the plan ceiling. That is safe because the pinned set is bounded by
// the write gate (canPinGalleryRecord), so a "full page" is at most 50 records, the same as one public explore
// page (VALIDATION_PAGINATION.LIMIT_MAX_BROWSE). The ceiling (including `max_pinned_records: -1`) lives in
// `public-gallery-count.ts`, shared with the public work counters so the profile never promises more than
// this gallery returns.

/**
 * The window of records the public profile can ever return: the plan ceiling bounds not only the page
 * size (`take`) but also its offset (`skip`). Without the second, pagination by `offset` walked past
 * the ceiling (FREE, limit 3, offsets 0/3/6/9 returned all 12 records in 4 requests).
 */
const resolvePublicGalleryWindow = ({
  ceiling,
  limit,
  offset,
}: {
  ceiling: number;
  limit: number | undefined;
  offset: number | undefined;
}): { take: number; skip: number } => {
  // Math.trunc plus a floor of zero: the contract (zod in the kernel) already rejects fractions and
  // out-of-range values, but this operation is exported and must itself keep floats and negatives away
  // from Prisma (skip/take would fail in Postgres and surface as 503).
  const skip = Math.min(Math.max(Math.trunc(offset ?? 0), 0), ceiling);
  const requested = Math.max(Math.trunc(limit ?? ceiling), 0);
  return { take: Math.min(requested, ceiling - skip), skip };
};

/** Strona rekordów galerii publicznej — wydzielona, by pusty wynik miał ten sam typ. */
const fetchPublicGalleryPage = ({
  where,
  take,
  skip,
}: {
  where: Prisma.GalleryRecordWhereInput;
  take: number;
  skip: number;
}) =>
  DB_CLIENT.use.galleryRecord.findMany({
    where,
    include: { ...GALLERY_COLORS_TRAITS_SELECT },
    // The stylist's chosen order, then newest first, then the cuid tiebreaker
    // (created_at is non-unique, so without it records swap across pages).
    orderBy: PINNED_GALLERY_RECORD_ORDER_BY,
    take,
    skip,
  });

type PublicGalleryRow = Awaited<
  ReturnType<typeof fetchPublicGalleryPage>
>[number];

/**
 * Get public gallery records for a stylist account
 * Only returns pinned records for active accounts
 */
export const publicGetGalleryRecordsByAccount_IO = async ({
  props,
}: {
  props: GALLERY_DTO_API_V1['PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT']['REQUEST'];
}): Promise<
  OperationResult<
    GalleryHandlerData<'PUBLIC_GET_GALLERY_RECORDS_BY_ACCOUNT'>,
    AccountNotFoundError | GalleryRecordNotFoundError | DatabaseError
  >
> => {
  try {
    const { account_id, color_ids, trait_ids, limit, offset } = props;

    // Get account info — full STYLIST_PUBLICLY_VISIBLE gate (account_status ACTIVE +
    // created_by_user.is_active). findFirst (not findUnique): findUnique.where only accepts
    // unique fields; created_by_user.is_active is non-unique, so we combine the unique
    // account_id with the relation filter via findFirst (same pattern as og-meta / account-profile
    // siblings). Not-visible → same ACCOUNT_NOT_FOUND as not-found (anti-enumeration parity).
    const account = await DB_CLIENT.use.stylistAccount.findFirst({
      where: {
        account_id: account_id,
        ...STYLIST_PUBLICLY_VISIBLE,
      },
      select: {
        account_id: true,
        display_name: true,
        business_name: true,
        address_city: true,
        pricing_plan: true,
        created_by_user_id: true,
        brand_accent_color: true,
      },
    });

    if (!account) {
      return failure({
        type: 'ACCOUNT_NOT_FOUND',
        accountId: account_id,
      });
    }

    // Build filter conditions
    const where: Prisma.GalleryRecordWhereInput = {
      created_by_account_id: account_id,
      // Only pinned records, minus those hidden by moderation.
      ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
    };

    // DECISION: color_ids/trait_ids are AND here (each id its own `some`), unlike the sibling explore/list
    // (apply_strict_filter, default OR). The divergence is harmless because this filter path is DORMANT: the
    // only consumer (main useStylistGallery) calls the public endpoint with { account_id } only and filters
    // client-side over the pinned records up to the plan ceiling (OR by default via exactMatch:false). It is
    // not rewritten speculatively. If a real server-side caller with a multi-select appears, mirror
    // explore/list: OR by default plus optional strict/AND.
    // Add color filters if provided
    if (color_ids && color_ids.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...color_ids.map(cid => ({
          colors: { some: { color_id: cid } },
        })),
      ];
    }

    // Add trait filters if provided
    if (trait_ids && trait_ids.length > 0) {
      where.AND = [
        ...(Array.isArray(where.AND) ? where.AND : []),
        ...trait_ids.map(tid => ({
          traits: { some: { trait_id: tid } },
        })),
      ];
    }

    // DECISION: the public gallery ceiling is the plan's pin limit, not a constant. A hard
    // `Math.min(limit || 5, 5)` voided the sold 3->10->15->30->50 ladder (Studio pinned 30 and the public
    // profile showed five). Writes never allow more pins than the plan (canPinGalleryRecord), so this is a
    // PAGE ceiling, not a second business gate, but it MUST cover the whole window (take AND skip) or
    // pagination bypasses it.
    const effective = await resolveEffectivePlan_IO({
      userId: account.created_by_user_id,
      ownPlan: account.pricing_plan,
    });
    const ceiling = resolvePublicGalleryCeiling(
      effective.effective_pricing_plan
    );
    const { take, skip } = resolvePublicGalleryWindow({
      ceiling,
      limit,
      offset,
    });

    // Get total count + paginated records in parallel
    const [totalCount, records] = await Promise.all([
      DB_CLIENT.use.galleryRecord.count({
        where,
      }),
      // Window exhausted (offset reached the plan ceiling): empty page WITHOUT a query.
      take > 0
        ? fetchPublicGalleryPage({ where, take, skip })
        : Promise.resolve<PublicGalleryRow[]>([]),
    ]);

    const showWatermark =
      effective.effective_pricing_plan === PricingPlanValue.FREE;

    return success({
      records: records.map(record => ({
        gallery_record_id: record.gallery_record_id,
        asset_url: record.asset_url,
        colors: mapGalleryColors(record.colors),
        traits: mapGalleryTraits(record.traits),
        nail_length: assertType(
          record.nail_length,
          isNailLengthNarrower,
          'nail_length in publicGetGalleryRecordsByAccount_IO'
        ),
        created_at: record.created_at,
      })),
      // DECISION: `total_count` is what this endpoint can actually return, so it is cut by the same plan
      // ceiling as `take`/`skip`. A bare `count(where)` was a number the endpoint could never deliver (FREE:
      // records=3, total_count=12) and handed the client an exact page count to walk. In the legal state this
      // is a no-op (the write gate and the pinned+visible `where` keep count <= ceiling); it only matters
      // after a plan downgrade, when pins stay and the ceiling drops, and then the ceiling is the truth.
      total_count: Math.min(totalCount, ceiling),
      show_watermark: showWatermark,
      stylist_info: {
        account_id: account.account_id,
        display_name: account.display_name,
        business_name: account.business_name,
        address_city: account.address_city,
        // The plan mask is applied on READ (the write gate does not clear the column on downgrade);
        // parity with the public profile.
        brand_accent_color: PRICING_POLICY.LIMITS[
          narrowPricingPlan(effective.effective_pricing_plan)
        ].can_brand_profile
          ? account.brand_accent_color
          : null,
      },
    });
  } catch (error) {
    return databaseFailure('publicGetGalleryRecordsByAccount_IO', error);
  }
};
