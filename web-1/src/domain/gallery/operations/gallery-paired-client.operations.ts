import { resolveSalonAccess_IO } from '@domain/pairing/salon-access.resolver';
import { resolveEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import { DB_CLIENT } from '@app/db/db.client';
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
import { STYLIST_PUBLICLY_VISIBLE } from '@domain/account/account.config';
import { PINNED_GALLERY_RECORD_ORDER_BY } from '@domain/gallery/gallery-record-visibility';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryRecordNotFoundError } from '@kernel/domain/gallery/gallery-errors.types';
import type { PairingSessionNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';
import type {
  DatabaseError,
  StylistNotFoundError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

// Helper extracted so we can reuse the inferred return type in the parent
// without manually re-declaring the Prisma include shape.
const fetchPairedClientRecords = (
  where: { created_by_account_id: string; is_hidden: boolean },
  take: number,
  skip: number
) =>
  DB_CLIENT.use.galleryRecord.findMany({
    where,
    include: { ...GALLERY_COLORS_TRAITS_SELECT },
    // Pinned block first, in the order the stylist set in her pin manager (the same
    // PINNED_GALLERY_RECORD_ORDER_BY the public profile reads), then the rest newest
    // first. Unpinning clears pinned_position, so the unpinned tail has only NULL
    // positions and falls through to created_at; the cuid tiebreaker inside the
    // shared order keeps offset pages stable.
    orderBy: [{ is_pinned: 'desc' }, ...PINNED_GALLERY_RECORD_ORDER_BY],
    take,
    skip,
  });

export const getGalleryForPairedClient_IO = async ({
  props,
  currentUserId,
}: {
  props: GALLERY_DTO_API_V1['GALLERY_GET_FOR_PAIRED_CLIENT']['REQUEST'];
  currentUserId: string;
}): Promise<
  OperationResult<
    GalleryHandlerData<'GALLERY_GET_FOR_PAIRED_CLIENT'>,
    | GalleryRecordNotFoundError
    | PairingSessionNotFoundError
    | StylistNotFoundError
    | DatabaseError
  >
> => {
  const { stylist_account_id, limit, offset } = props;

  let account;
  let pair;
  try {
    // Account existence + pair check run in parallel (independent queries).
    [account, pair] = await Promise.all([
      // DECISION: the stylist anchor is gated by the FULL two-axis STYLIST_PUBLICLY_VISIBLE invariant
      // (account_status ACTIVE and created_by_user.is_active), not account_status alone: after self-disable
      // or soft-delete (DOMAIN_SSOT §13.1) is_active=false can coexist with account_status ACTIVE, and the
      // old gate let a paired client read the private gallery (asset_url) and PII of a no-longer-public
      // stylist. Same gate as bookmarkStylist_IO and the favorite-records read filter. findFirst, not
      // findUnique, because the predicate mixes the unique account_id with non-unique fields. No row falls
      // through to the STYLIST_NOT_FOUND below (anti-enumeration); an active pair is no bypass here.
      DB_CLIENT.use.stylistAccount.findFirst({
        where: {
          account_id: stylist_account_id,
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
      }),
      resolveSalonAccess_IO(currentUserId, stylist_account_id),
    ]);
  } catch (error) {
    return databaseFailure('getGalleryForPairedClient', error);
  }

  if (!account) {
    // DECISION: stylistAccount.findFirst (STYLIST_PUBLICLY_VISIBLE) returns null when the id is not a
    // publicly visible stylist (a client account_id, or a stylist inactive/deleted/banned on either axis).
    // STYLIST_NOT_FOUND is the right semantic there; GALLERY_RECORD_NOT_FOUND was misleading because no
    // gallery lookup has happened yet. A valid stylist with no pairing still gets PAIRING_SESSION_NOT_FOUND below.
    return failure({
      type: 'STYLIST_NOT_FOUND',
      stylistAccountId: stylist_account_id,
    });
  }

  if (!pair) {
    return failure({
      type: 'PAIRING_SESSION_NOT_FOUND',
      sessionId: '',
    });
  }

  const safeLimit = Math.min(limit || 50, 100);

  // DECISION: there is deliberately NO plan cap on how many records a paired client reads (DOMAIN_SSOT §4.2:
  // the full gallery after pairing is ALL the stylist's photos). A paired client (an ACTIVE pairing is a real
  // client) sees the full non-hidden gallery whatever the stylist's plan. `max_gallery_records`
  // (pricing.policy) gates record CREATION, not visibility; after a downgrade to Free records persist and
  // paired clients keep seeing them, since hiding existing portfolio from the stylist's own clients would
  // break the core product. The only plan-masked read here is `brand_accent_color` below (branding is the
  // explicit paid entitlement `can_brand_profile`). Reviews repeatedly flag this as a "monetization leak":
  // it is not a bug.
  const pairedClientWhere = {
    created_by_account_id: stylist_account_id,
    is_hidden: false, // Exclude records hidden by moderation
  };

  let totalCount: number;
  let records: Awaited<ReturnType<typeof fetchPairedClientRecords>>;
  try {
    [totalCount, records] = await Promise.all([
      DB_CLIENT.use.galleryRecord.count({ where: pairedClientWhere }),
      fetchPairedClientRecords(pairedClientWhere, safeLimit, offset || 0),
    ]);
  } catch (error) {
    return databaseFailure('getGalleryForPairedClient:fetchRecords', error);
  }

  let effectivePlan;
  try {
    effectivePlan = (
      await resolveEffectivePlan_IO({
        userId: account.created_by_user_id,
        ownPlan: account.pricing_plan,
      })
    ).effective_pricing_plan;
  } catch (error) {
    return databaseFailure('getGalleryForPairedClient:plan', error);
  }
  return success({
    records: records.map(record => ({
      gallery_record_id: record.gallery_record_id,
      asset_url: record.asset_url,
      is_pinned: record.is_pinned,
      colors: mapGalleryColors(record.colors),
      traits: mapGalleryTraits(record.traits),
      nail_length: assertType(
        record.nail_length,
        isNailLengthNarrower,
        'nail_length in getGalleryForPairedClient_IO'
      ),
      created_at: record.created_at,
    })),
    total_count: totalCount,
    stylist_info: {
      account_id: account.account_id,
      display_name: account.display_name,
      business_name: account.business_name,
      address_city: account.address_city,
      // Read-time plan mask, same as the public profile and gallery-public.
      // The write gate does not clear the column on downgrade.
      brand_accent_color: PRICING_POLICY.LIMITS[
        narrowPricingPlan(effectivePlan)
      ].can_brand_profile
        ? account.brand_accent_color
        : null,
    },
  });
};
