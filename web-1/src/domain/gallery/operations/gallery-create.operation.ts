import { resolveEffectivePlan_IO } from '@app/pricing/effective-plan.resolver';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { hasCode } from '@kernel/models/type_narrowing';
import type { IDType } from '@kernel/application/application.types';
import type { GalleryRecord } from '@kernel/models/db_models.generated.dto';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { NAIL_LENGTHS } from '@kernel/domain/gallery/nail-length.config';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { PlanConfigType } from '@kernel/policies/pricing.policy';
import {
  isUnlimitedLimit,
  PRICING_POLICY,
} from '@kernel/policies/pricing.policy';
import { getPlanConfig } from '@app/pricing/plan-config.cache';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type { GalleryLimitReachedError } from '@kernel/domain/gallery/gallery-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { cleanupCloudinaryAsset } from './gallery-cloudinary-cleanup';
import { incrementGalleryCount } from './gallery-count.helper';
import { extractPublicIdFromUrl } from '@app/cloudinary/cloudinary-url.utils';
import { findForeignAssetOwner } from '@domain/_shared/guards/cloudinary-asset.guard';
import { acquireAdvisoryXactLock } from '@app/db/lock-rows';

type CreateGalleryRecordArgs = {
  props: {
    created_by_account_id: IDType;
    asset_url: string;
    color_ids: string[];
    trait_ids: string[];
    nail_length: NailLength;
  };
  id: IDType;
};

type CreateGalleryRecordResult = OperationResult<
  GalleryRecord,
  | GalleryLimitReachedError
  | AccountNotFoundError
  | ValidationError
  | DatabaseError
>;

/**
 * Rollback sentinel for the gallery-create transaction.
 * Thrown inside Prisma $transaction when the post-create recount sees the plan
 * limit lost to a concurrent insert, so the whole transaction rolls back.
 * The outer catch maps this class (instanceof) to GALLERY_LIMIT_REACHED, not
 * DATABASE_ERROR. Same pattern as PairingLimitExceededRollback.
 */
class GalleryQuotaRaceRollback extends Error {
  constructor() {
    super('Gallery quota race detected');
  }
}

/**
 * Create a new gallery record with color/trait junction records.
 * Wrapped by createGalleryRecord_IO which adds Cloudinary orphan cleanup (B14).
 */
const runCreateGalleryRecord = async ({
  props,
  id,
}: CreateGalleryRecordArgs): Promise<CreateGalleryRecordResult> => {
  const {
    created_by_account_id,
    asset_url,
    color_ids: rawColorIds,
    trait_ids: rawTraitIds,
    nail_length,
  } = props;

  // Deduplicate IDs to prevent unique constraint violations
  const color_ids = [...new Set(rawColorIds)];
  const trait_ids = [...new Set(rawTraitIds)];

  if (!created_by_account_id || !asset_url) {
    reportIssueBackend({
      namespace: 'createGalleryRecord_IO',
      message: `!created_by_account_id || !asset_url. created_by_account_id: ${created_by_account_id} asset_url: ${asset_url}`,
      payload: { color_ids, trait_ids },
      mode: 'error',
    });
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'created_by_account_id',
      message: 'Missing required field',
    });
  }

  // DECISION: `asset_url` comes FROM THE CLIENT (the upload goes straight to the cloud) and the kernel
  // validator only proves it points at our CDN, the same insufficient "domain prefix" that bit visit photos
  // and the avatar. Gallery was the third surface taking a foreign address and the only one without this
  // gate, and it is the SOURCE of addresses for the other two (the public profile prints `asset_url` in
  // HTML). Copying someone's URL would (a) put their work in your portfolio and (b) pin their file: the
  // cleanup sink (gallery-cloudinary-cleanup) sees the attacker's live reference and refuses to delete,
  // so the victim could not remove their own photo from the vendor. The same URL within your own account
  // passes (own file) and ends as returning the existing record (public_id idempotency in the tx below).
  // One gate for all three surfaces: `_shared/guards/cloudinary-asset.guard`.
  const ownership = await findForeignAssetOwner(
    asset_url,
    String(created_by_account_id)
  );
  if (ownership !== 'OWN') {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'asset_url',
      message:
        ownership === 'FOREIGN'
          ? 'Asset URL belongs to another account'
          : 'Asset URL is not a recognized Cloudinary upload address',
    });
  }

  // DECISION: the quota uses count-then-create plus a POST-CREATE VERIFY. The pre-check fails fast when
  // clearly over the limit; the count after create inside the same transaction catches concurrent inserts
  // that slipped past it, and finalCount > limit throws to roll back. No SERIALIZABLE isolation: no
  // deadlock risk and it works at standard Postgres isolation.

  // DECISION: the gallery cap is a pure code invariant, planConfig.max_gallery_records (per-plan SSOT in
  // PRICING_POLICY), with NO runtime override. The old MAX_GALLERY_RECORDS runtime knob (seeded ungated at
  // '50', silently raising free users from 5 to 50) was removed from RUNTIME_CONFIG_KEYS and from both
  // consumers (here and user-query.operations.ts): a stray non-predefined runtimeConfig row would otherwise
  // still override the cap, making the invariant depend on the seed prune instead of code, and display
  // (usage-stats) now equals enforcement by construction. A tunable ceiling must be re-added properly via
  // RUNTIME_CONFIG_KEYS, not by reviving that read. The immutable plan config is pre-fetched OUTSIDE the
  // transaction to keep it short, and the gate uses PRICING_POLICY.utils.canCreateGalleryRecord (handles
  // the -1/unlimited sentinel).
  let planConfig: PlanConfigType;
  let planLimit: number;
  let planType: PricingPlan;
  try {
    const account = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { account_id: created_by_account_id },
      select: { pricing_plan: true, created_by_user_id: true },
    });
    if (!account) {
      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Account not found: ${created_by_account_id}`,
        payload: { created_by_account_id },
        mode: 'error',
      });
      return failure({
        type: 'ACCOUNT_NOT_FOUND' as const,
        accountId: String(created_by_account_id),
      });
    }
    const effective = await resolveEffectivePlan_IO({
      userId: account.created_by_user_id,
      ownPlan: account.pricing_plan,
    });
    planConfig = await getPlanConfig(effective.effective_pricing_plan);
    planLimit = planConfig.max_gallery_records;
    planType = effective.effective_pricing_plan;
  } catch (error) {
    return databaseFailure('createGalleryRecord_IO:plan-lookup', error);
  }

  // DECISION: curation gate. color_id/trait_id must reference ACTIVE dictionary entries: `is_active=false`
  // is how admin retires a color/trait (it leaves the GET_COLORS/GET_TRAITS pickers), but a nested junction
  // create only enforces FK existence (P2003), so a stylist holding a cached retired id could keep attaching
  // it to NEW records. One findMany per dictionary (id IN ..., is_active:true, index-backed) over the
  // deduped set; a count mismatch means a missing or retired id and is rejected as VALIDATION_ERROR before
  // the quota tx. It runs outside the tx (reference-data read, like the plan pre-fetch). Accepted residual
  // TOCTOU: an entry retired between check and create still lands, bounded like the by-design historical
  // ghosting in gallery-list/detail, and the P2003 catch below covers an id DELETED in that window.
  // Create-time only; existing records keep retired entries.
  try {
    if (color_ids.length > 0) {
      const activeColors = await DB_CLIENT.use.color.findMany({
        where: { id: { in: color_ids }, is_active: true },
        select: { id: true },
      });
      if (activeColors.length !== color_ids.length) {
        reportIssueBackend({
          namespace: 'createGalleryRecord_IO',
          message: `Rejected create: one or more color_ids are inactive/non-existent for account ${created_by_account_id}`,
          payload: { created_by_account_id, color_ids },
          mode: 'info',
        });
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'color_ids',
          message: 'One or more colors are unavailable',
        });
      }
    }

    if (trait_ids.length > 0) {
      const activeTraits = await DB_CLIENT.use.trait.findMany({
        where: { id: { in: trait_ids }, is_active: true },
        select: { id: true },
      });
      if (activeTraits.length !== trait_ids.length) {
        reportIssueBackend({
          namespace: 'createGalleryRecord_IO',
          message: `Rejected create: one or more trait_ids are inactive/non-existent for account ${created_by_account_id}`,
          payload: { created_by_account_id, trait_ids },
          mode: 'info',
        });
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'trait_ids',
          message: 'One or more style traits are unavailable',
        });
      }
    }
  } catch (error) {
    return databaseFailure(
      'createGalleryRecord_IO:reference-validation',
      error
    );
  }

  // The ownership gate returns OWN only for a URL with a recognized public_id,
  // so the id is present here; null stays a defensive branch.
  const assetPublicId = extractPublicIdFromUrl(asset_url);

  try {
    const result = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION: before insert, take a transaction advisory lock on
      // (account, public_id) and, when findFirst sees a row, return it.
      // The check sits before the limit count. gallery-create.dedup.test.ts
      // checks that mocked path, the lock key, and that count is not called.
      // It does not run two transactions.
      if (assetPublicId !== null) {
        await acquireAdvisoryXactLock(
          tx,
          `gallery-create:${String(created_by_account_id)}:${assetPublicId}`
        );
        const existingRecord = await tx.galleryRecord.findFirst({
          where: { created_by_account_id, public_id: assetPublicId },
          orderBy: { created_at: 'asc' },
        });
        if (existingRecord) {
          reportIssueBackend({
            namespace: 'createGalleryRecord_IO',
            message: `Duplicate create for an already stored asset — returning existing record for account ${created_by_account_id}`,
            payload: {
              gallery_record_id: existingRecord.gallery_record_id,
              id,
            },
            mode: 'info',
          });
          return success(existingRecord);
        }
      }

      const currentCount = await tx.galleryRecord.count({
        where: { created_by_account_id },
      });

      // Pre-check: fast-fail when clearly over limit (avoids needless create).
      // Canonical quota predicate (handles the -1/unlimited sentinel internally),
      // so the inline `>=` no longer diverges from the other 6 quota call-sites.
      if (
        !PRICING_POLICY.utils.canCreateGalleryRecord(planConfig, currentCount)
      ) {
        reportIssueBackend({
          namespace: 'createGalleryRecord_IO',
          message: `Gallery limit reached for account ${created_by_account_id}. Plan: ${planType}, Count: ${currentCount}/${planLimit}`,
          payload: {
            created_by_account_id,
            currentCount,
            limit: planLimit,
          },
          mode: 'info',
        });

        return failure({
          type: 'GALLERY_LIMIT_REACHED' as const,
          currentCount,
          limit: planLimit,
          planType,
        });
      }

      const createdRecord = await tx.galleryRecord.create({
        data: {
          created_by_account_id,
          asset_url,
          // public_id is stored with the URL so the ownership gate can use the
          // index instead of scanning every address. null means the URL did not
          // parse; that row stays on the slower in-code compare and still
          // protects its file (cloudinary-asset.guard.ts).
          public_id: assetPublicId,
          nail_length: nail_length ?? NAIL_LENGTHS.MEDIUM,
          colors: {
            create: color_ids.map(color_id => ({ color_id })),
          },
          traits: {
            create: trait_ids.map(trait_id => ({ trait_id })),
          },
        },
      });

      // DECISION: cached_gallery_count is incremented inside the SAME transaction as the create (both commit
      // or both roll back; the quota-race path throws '__QUOTA_RACE__' and rolls the increment back too).
      // gallery-count.helper.ts is the single writer, shared with delete and moderation.
      await incrementGalleryCount(tx, created_by_account_id, 1);

      // POST-CREATE VERIFY: re-count inside TX to detect concurrent race winners
      if (!isUnlimitedLimit(planLimit)) {
        const finalCount = await tx.galleryRecord.count({
          where: { created_by_account_id },
        });
        if (finalCount > planLimit) {
          // Throw to trigger rollback — caller handles QUOTA_EXCEEDED via catch
          throw new GalleryQuotaRaceRollback();
        }
      }

      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Gallery record created successfully for account ${created_by_account_id}`,
        payload: { gallery_record_id: createdRecord.gallery_record_id, id },
        mode: 'info',
      });

      return success(createdRecord);
    });

    return result;
  } catch (error) {
    if (error instanceof GalleryQuotaRaceRollback) {
      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Gallery limit race detected for account ${created_by_account_id} — rolled back. Plan: ${planType}, Limit: ${planLimit}`,
        payload: { created_by_account_id, planType, planLimit },
        mode: 'info',
      });
      return failure({
        type: 'GALLERY_LIMIT_REACHED' as const,
        currentCount: planLimit,
        limit: planLimit,
        planType,
      });
    }

    // DECISION: P2003 on the nested colors/traits create means a well-formed but non-existent
    // color_id/trait_id from a stale client dictionary. That is bad INPUT, not a DB outage, so it maps to
    // VALIDATION_ERROR (4xx) and logs as mode:'info'; going through databaseFailure (mode:'error' plus
    // stack) would pollute the anomaly channel as if Postgres were down. The active-reference pre-validation
    // above is the primary gate (it also enforces is_active, which P2003 cannot); this catch is the safety
    // net for an id deleted between that check and the create.
    if (hasCode(error) && error.code === 'P2003') {
      reportIssueBackend({
        namespace: 'createGalleryRecord_IO',
        message: `Invalid color_id/trait_id (FK P2003) for account ${created_by_account_id}`,
        payload: { created_by_account_id, color_ids, trait_ids },
        mode: 'info',
      });
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'color_ids/trait_ids',
        message: 'One or more color or trait IDs do not exist',
      });
    }

    return databaseFailure('createGalleryRecord_IO', error);
  }
};

// DECISION: the Cloudinary asset is uploaded client-side (step 1) BEFORE this call (step 2), so every
// failure (quota, validation, account, DB) would leave an orphan in Cloudinary. It is cleaned
// fire-and-forget (cleanupCloudinaryAsset has retry/backoff) as the single path covering ALL error
// branches, including GALLERY_LIMIT_REACHED, which is only known server-side after the upload. Success
// keeps the asset; no asset_url means nothing to clean.
export const createGalleryRecord_IO = async (
  args: CreateGalleryRecordArgs
): Promise<CreateGalleryRecordResult> => {
  const result = await runCreateGalleryRecord(args);
  if (!result.success && args.props.asset_url) {
    cleanupCloudinaryAsset(args.props.asset_url);
  }
  return result;
};
