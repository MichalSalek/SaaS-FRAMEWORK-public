import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
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

  // DECISION (nie usuwaj tego komentarza):
  // The DISPLAYED max_gallery_records MUST equal the ENFORCED one, and both are now a
  // PURE CODE INVARIANT = planConfig.max_gallery_records (per-plan SSOT in PRICING_POLICY:
  // FREE=5, paid=-1/unlimited). There is NO runtime override on either surface.
  // gallery-core-1b: enforcement (createGalleryRecord_IO) and this display read used to
  // mirror an optional MAX_GALLERY_RECORDS runtime override (getRuntimeConfigValue) so the
  // two stayed in sync. That knob was REMOVED from RUNTIME_CONFIG_KEYS (kernel) and the
  // override-read was removed from BOTH consumers: the key is no longer seeded so the read
  // was dead, AND a stray/manual/stale non-predefined runtimeConfig row would otherwise
  // still override the displayed cap (display/enforcement split if it survived the prune).
  // With the read gone, display == enforcement by construction — both derive from the same
  // per-plan config, no runtimeConfig dependency. If a live-tunable ceiling is ever needed,
  // re-add it PROPERLY via RUNTIME_CONFIG_KEYS in BOTH places, not by reviving this read.
  const displayMaxGalleryRecords = planConfig.max_gallery_records;

  try {
    const [
      galleryCount,
      favoritesCount,
      pairedCount,
      hourlySharesCount,
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
      // DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
      // Liczymy po `stylist_account_id`, czyli po TEJ SAMEJ OSI, na której limit
      // jest egzekwowany (`session-container-share.operation.ts`: „shares-per-hour
      // jest GLOBALNA per-stylistka — throughput jej inboxu"). Wcześniej licznik
      // filtrował po `client_account.created_by_user_id`, czyli po udostępnieniach,
      // które użytkowniczka wysłała jako KLIENTKA — a mianownik obok niego to jej
      // limit STYLISTKI z planu. Kafel pokazywał więc „0 / 20" i nie mógł się ruszyć
      // nawet wtedy, gdy jej klientkom leciało `SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED`:
      // jedyny ekran tłumaczący ten limit strukturalnie nie umiał go pokazać.
      // Licznik i limit MUSZĄ chodzić po jednej osi — inaczej ułamek jest fikcją.
      stylistAccountId
        ? DB_CLIENT.use.sessionContainer.count({
            where: {
              stylist_account_id: stylistAccountId,
              shared_at: { gte: new Date(Date.now() - TIME.MS_PER_HOUR) },
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
      hourly_shares: hourlySharesCount,
      favorite_records_count: favoriteRecordsCount,
      pinned_records: pinnedRecordsCount,
      limits: {
        max_gallery_records: displayMaxGalleryRecords,
        max_paired_stylists: PRICING_POLICY.PLATFORM_LIMITS.MAX_PAIRED_STYLISTS,
        max_paired_clients: planConfig.max_paired_clients,
        max_shares_per_hour: planConfig.max_shares_per_hour,
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

  // DECISION (nie usuwaj tego komentarza):
  // Post-normalization length guard (fix user-account-3). The HTTP validator
  // (VALIDATION_POLICY.validators.userChangeName) checks NAME_MIN on the RAW
  // trimmed body, but normalizeStringCapitalizedWords strips every char outside
  // [\p{L}\p{N}\s'] (UNICODE_WORD_CLEANUP). Inputs made only of emoji/punctuation
  // (e.g. "🎉🎉", "...") pass raw min-length yet collapse to "" - persisting a
  // blank personal name. We re-check the NORMALIZED value here (the actual write
  // boundary) so the stored value always satisfies NAME_MIN regardless of caller.
  // Returns VALIDATION_ERROR → mapErrorToResponse → respondValidationFailed (400),
  // consistent with the validator's own tooShort path.
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
