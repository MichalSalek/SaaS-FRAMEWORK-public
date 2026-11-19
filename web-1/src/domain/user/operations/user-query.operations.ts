import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { VISIBLE_PINNED_GALLERY_RECORD_WHERE } from '@domain/gallery/gallery-record-visibility';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { UserNotFoundError } from '@kernel/domain/user-and-account/user-errors.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import { isP2025 } from '@app/db/prisma-error';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import {
  SystemRoleId,
  type SystemRoleIdType,
} from '@kernel/models/db_models.manual.dto';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { VALIDATION_POLICY } from '@kernel/policies/validation.policy';

/**
 * Get account state for a user
 */
export const getAccountState_IO = async ({
  userId,
  roleId,
}: {
  userId: string;
  roleId: SystemRoleIdType;
}): Promise<
  OperationResult<
    USER_DTO_API_V1['USER_GET_ACCOUNT_STATE']['RESPONSE'],
    DatabaseError
  >
> => {
  try {
    const [stylistAccount, clientAccount] = await Promise.all([
      DB_CLIENT.use.stylistAccount.findUnique({
        where: { created_by_user_id: userId },
        select: { account_id: true },
      }),
      DB_CLIENT.use.clientAccount.findUnique({
        where: { created_by_user_id: userId },
        select: { client_account_id: true },
      }),
    ]);

    const hasStylistAccount = Boolean(stylistAccount);
    const hasClientAccount = Boolean(clientAccount);
    const needsOnboarding =
      roleId === SystemRoleId.CLIENT_ROLE &&
      !hasStylistAccount &&
      !hasClientAccount;

    return success({
      role_id: roleId,
      has_stylist_account: hasStylistAccount,
      has_client_account: hasClientAccount,
      needs_onboarding: needsOnboarding,
    });
  } catch (error) {
    return databaseFailure('getAccountState', error);
  }
};

type UsageStatsResponse = USER_DTO_API_V1['USER_GET_USAGE_STATS']['RESPONSE'];

/**
 * Get usage stats with parallel queries
 */
export const getUsageStats_IO = async ({
  userId,
  stylistAccountId,
  pricingPlan,
}: {
  userId: string;
  stylistAccountId?: string | undefined;
  pricingPlan?: PricingPlan | undefined;
}): Promise<OperationResult<UsageStatsResponse, DatabaseError>> => {
  const effectivePlan = pricingPlan || PricingPlanValue.FREE;
  const planConfig = PRICING_POLICY.utils.getPlanConfig(effectivePlan);

  // DECISION: the DISPLAYED max_gallery_records MUST equal the ENFORCED one; both read
  // planConfig.max_gallery_records with no runtime override (see
  // web-1/src/domain/gallery/operations/gallery-create.operation.ts).
  const displayMaxGalleryRecords = planConfig.max_gallery_records;

  try {
    const [
      galleryCount,
      favoritesCount,
      pairedCount,
      favoriteRecordsCount,
      pinnedRecordsCount,
    ] = await Promise.all([
      stylistAccountId
        ? DB_CLIENT.use.galleryRecord.count({
            where: { created_by_account_id: stylistAccountId },
          })
        : Promise.resolve(0),
      DB_CLIENT.use.favoriteStylist.count({
        where: { client_user_id: userId },
      }),
      stylistAccountId
        ? DB_CLIENT.use.clientStylistPair.count({
            where: {
              stylist_account_id: stylistAccountId,
              status: PairingStatusValue.ACTIVE,
            },
          })
        : Promise.resolve(0),
      DB_CLIENT.use.favoriteGalleryRecord.count({
        where: { client_user_id: userId },
      }),
      stylistAccountId
        ? DB_CLIENT.use.galleryRecord.count({
            // Same set the pin gate enforces and the public profile shows: a pin
            // hidden by moderation frees its slot, so it must not fill the tile
            // (PinnedManager disables pinning from this number).
            where: {
              created_by_account_id: stylistAccountId,
              ...VISIBLE_PINNED_GALLERY_RECORD_WHERE,
            },
          })
        : Promise.resolve(0),
    ]);

    return success({
      gallery_records: galleryCount,
      favorite_stylists: favoritesCount,
      paired_clients: pairedCount,
      favorite_records_count: favoriteRecordsCount,
      pinned_records: pinnedRecordsCount,
      limits: {
        max_gallery_records: displayMaxGalleryRecords,
        max_paired_stylists: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        max_paired_clients: planConfig.max_paired_clients,
        max_pinned_records: planConfig.max_pinned_records,
        can_use_session_share: planConfig.can_use_session_share,
        can_use_multi_session: planConfig.can_use_multi_session,
        can_use_staff_accounts: planConfig.can_use_staff_accounts,
      },
      pricing_plan: effectivePlan,
    });
  } catch (error) {
    return databaseFailure('getUsageStats', error);
  }
};

/**
 * Change user name
 */
export const changeUserName_IO = async ({
  userId,
  name,
}: {
  userId: string;
  name: string;
}): Promise<
  OperationResult<
    { id: string; name: string },
    UserNotFoundError | ValidationError | DatabaseError
  >
> => {
  const normalizedName =
    VALIDATION_POLICY.utils.normalizeStringCapitalizedWords(name);

  // DECISION: post-normalization length guard. The HTTP validator checks NAME_MIN on the RAW trimmed body,
  // but normalizeStringCapitalizedWords strips every char outside [\p{L}\p{N}\s'], so emoji/punctuation-only
  // input ("🎉🎉", "...") passes the raw check and collapses to "". The NORMALIZED value is re-checked here
  // (the actual write boundary) so the stored name always satisfies NAME_MIN; failure maps to
  // VALIDATION_ERROR -> 400, like the validator's own tooShort path.
  if (
    !VALIDATION_POLICY.utils.validateByMinLength(
      normalizedName,
      VALIDATION_LENGTHS.NAME_MIN
    )
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'name',
      message: `Name must contain at least ${VALIDATION_LENGTHS.NAME_MIN} valid characters`,
    });
  }

  try {
    const user = await DB_CLIENT.use.user.update({
      where: { id: userId },
      data: { name: normalizedName },
      select: { id: true, name: true },
    });

    reportIssueBackend({
      namespace: 'changeUserName',
      message: `Name changed successfully: ${user.name}`,
      payload: { id: user.id, new_name: user.name },
      mode: 'info',
    });

    return success({ id: user.id, name: user.name });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId });
    }
    return databaseFailure('changeUserName', error);
  }
};
