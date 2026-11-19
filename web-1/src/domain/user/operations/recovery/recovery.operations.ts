import { finishAcceptedSalonInvitations } from '@domain/salon-staff/salon-invitation-token.service';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { prepareRecoveredVanity } from '@domain/account/profile-link-recovery';
import type { DeletedUserBackup } from '@kernel/domain/recovery/deleted-user-backup.types';
import { RECOVERY_CONFIG } from '@kernel/domain/recovery/deleted-user-backup.types';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  AccountStatusValue,
  NailLengthValue,
} from '@kernel/models/db_models.generated.dto';
import type { AccountType } from '@kernel/models/db_models.generated.dto';

/**
 * Runtime type guard for DeletedUserBackup JSON data.
 * Validates structural shape after JSON.parse — prevents silent runtime corruption.
 */
const isDeletedUserBackup = (data: unknown): data is DeletedUserBackup => {
  if (data == null || typeof data !== 'object') {
    return false;
  }
  const d = data as Record<string, unknown>;
  return (
    typeof d.id === 'string' &&
    typeof d.email === 'string' &&
    typeof d.name === 'string' &&
    typeof d.role_id === 'string' &&
    typeof d.is_active === 'boolean' &&
    typeof d.account_type === 'string' &&
    // Prisma camelCases User.createdAt in JSON output (DB column is created_at)
    typeof d.createdAt === 'string' &&
    (d.stylist_account === null || typeof d.stylist_account === 'object') &&
    (d.client_account === null || typeof d.client_account === 'object')
  );
};

const DB = DB_CLIENT.use;

type TxClient = Parameters<Parameters<typeof DB.$transaction>[0]>[0];

/**
 * Get the cutoff date for recovery eligibility (RECOVERY_CONFIG.MAX_DAYS ago)
 */
const getRecoveryCutoffDate = (): Date => {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - RECOVERY_CONFIG.MAX_DAYS);
  return cutoff;
};

const recoverableBackupWhere = (cutoff: Date) => ({
  created_at: { gte: cutoff },
  recovered_at: null, // Not already recovered
  is_gdpr_erased: { not: true },
  is_move_archive: { not: true },
});

/**
 * Fast path: DB-level lookup on the denormalized DeletedUser.email column
 * (M7 r28 follow-up — the column + @@index([email]) landed, replacing the
 * "load 100 rows and JSON-parse each" scan for rows written after the column).
 *
 * DECISION: `mode: 'insensitive'` mirrors the legacy scan's toLowerCase() comparison (a parity safety
 * net, since Better Auth stores e-mails lowercased). It costs the plain btree index for THIS query,
 * acceptable at DeletedUser row counts; once writers persist the column normalized (normalizeEmail) it
 * can become an exact `equals` that uses the index.
 */
const findRecoverableBackupByEmail = async ({
  email,
  cutoff,
}: {
  email: string;
  cutoff: Date;
}): Promise<{ user_id: string; body: unknown } | null> => {
  return DB.deletedUser.findFirst({
    where: {
      ...recoverableBackupWhere(cutoff),
      email: { equals: email, mode: 'insensitive' },
    },
    orderBy: { created_at: 'desc' },
    select: { user_id: true, body: true },
  });
};

/**
 * Legacy fallback loader: recoverable rows WITHOUT the email column (written
 * before it existed) — findMatchingBackup then matches on body.email.
 *
 * DECISION: `email: null` restricts the JSON scan to legacy rows ONLY; rows with the column populated
 * are already covered by the fast path above. Kept even though pre-production DBs may be reset (a stale
 * legacy row must never silently lose its recovery window); the 100-row cap plus JSON parse is fine at
 * under 100 legacy backups.
 */
const loadRecentRecoverableBackups = async ({
  cutoff,
  limit,
}: {
  cutoff: Date;
  limit: number;
}): Promise<Array<{ user_id: string; body: unknown; created_at: Date }>> => {
  return DB.deletedUser.findMany({
    where: {
      ...recoverableBackupWhere(cutoff),
      email: null,
    },
    orderBy: { created_at: 'desc' },
    take: limit, // Safety limit
  });
};

/**
 * Search a list of deleted-user rows for one whose backup JSON matches the given email.
 * Returns the parsed backup and original user_id, or null if not found.
 */
const findMatchingBackup = (
  email: string,
  deletedUsers: Array<{ user_id: string; body: unknown }>
): { backup: DeletedUserBackup; deletedUserId: string } | null => {
  for (const du of deletedUsers) {
    try {
      const parsed: unknown = du.body;
      if (!isDeletedUserBackup(parsed)) {
        reportIssueBackend({
          namespace: 'RECOVERY',
          message: `Invalid DeletedUser backup structure (user_id: ${du.user_id})`,
          payload: null,
          mode: 'warn',
        });
        continue;
      }
      if (parsed.email.toLowerCase() === email.toLowerCase()) {
        return { backup: parsed, deletedUserId: du.user_id };
      }
    } catch {
      reportIssueBackend({
        namespace: 'RECOVERY',
        message: `Failed to parse DeletedUser backup (user_id: ${du.user_id})`,
        payload: null,
        mode: 'warn',
      });
    }
  }
  return null;
};

/**
 * Step 1: Restore user fields (name, image, role_id, account_type) from backup.
 */
const restoreUserFields = async (
  tx: TxClient,
  userId: string,
  backup: DeletedUserBackup
): Promise<void> => {
  await tx.user.update({
    where: { id: userId },
    data: {
      name: backup.name,
      image: backup.image,
      role_id: backup.role_id,
      account_type: backup.account_type,
    },
  });
};

/**
 * Chunked restore of gallery records with their color/trait junction rows.
 * Returns the number of records actually restored.
 */
const restoreGalleryRecords = async (
  tx: TxClient,
  accountId: string,
  galleryRecords: NonNullable<
    NonNullable<DeletedUserBackup['stylist_account']>['gallery_record']
  >,
  allColorIds: Set<string>,
  allTraitIds: Set<string>
): Promise<number> => {
  let count = 0;
  const CHUNK_SIZE = 10;

  for (let i = 0; i < galleryRecords.length; i += CHUNK_SIZE) {
    const chunk = galleryRecords.slice(i, i + CHUNK_SIZE);

    await Promise.all(
      chunk.map(async gr => {
        const createdRecord = await tx.galleryRecord.create({
          data: {
            created_by_account_id: accountId,
            asset_url: gr.asset_url,
            nail_length: gr.nail_length ?? NailLengthValue.MEDIUM,
            is_pinned: gr.is_pinned,
          },
        });

        const junctionOps: Promise<unknown>[] = [];

        if (gr.colors && gr.colors.length > 0) {
          const validColorIds = gr.colors
            .map(c => c.color_id)
            .filter(id => allColorIds.has(id));
          if (validColorIds.length > 0) {
            junctionOps.push(
              tx.galleryRecordColor.createMany({
                data: validColorIds.map(colorId => ({
                  gallery_record_id: createdRecord.gallery_record_id,
                  color_id: colorId,
                })),
                skipDuplicates: true,
              })
            );
          }
        }

        if (gr.traits && gr.traits.length > 0) {
          const validTraitIds = gr.traits
            .map(t => t.trait_id)
            .filter(id => allTraitIds.has(id));
          if (validTraitIds.length > 0) {
            junctionOps.push(
              tx.galleryRecordTrait.createMany({
                data: validTraitIds.map(traitId => ({
                  gallery_record_id: createdRecord.gallery_record_id,
                  trait_id: traitId,
                })),
                skipDuplicates: true,
              })
            );
          }
        }

        await Promise.all(junctionOps);
        count++;
      })
    );
  }

  return count;
};

/**
 * Steps 2+3: Create/upsert StylistAccount and restore its gallery records.
 * Returns the number of gallery records restored.
 */
const restoreStylistAccount = async (
  tx: TxClient,
  userId: string,
  backup: DeletedUserBackup
): Promise<number> => {
  const sa = backup.stylist_account;
  if (!sa) {
    return 0;
  }

  // Historical DECISION, superseded by the shared profile-link namespace lock:
  // the check-then-upsert TOCTOU was tolerated because the graceful drop covered
  // an already-claimed vanity, while a concurrent claim could cause P2002 and
  // a retry. The common lock now also protects retired links and orders writers.
  // Recovery drops an unavailable slug instead of shadowing its owner.
  const vanityUrl = await prepareRecoveredVanity(tx, userId, sa.vanity_url);

  // Create stylist account with reset pricing (incentive to re-subscribe)
  // Upsert: idempotent to avoid P2002 unique constraint error
  // (dev-login may create bare-bones account before restore runs)
  const restoredAccount = await tx.stylistAccount.upsert({
    where: { created_by_user_id: userId },
    create: {
      created_by_user_id: userId,
      display_name: sa.display_name,
      pricing_plan: PricingPlanValue.FREE,
      payment_status: PaymentStatusValue.UNPAID,
      account_status: AccountStatusValue.ACTIVE,
      business_name: sa.business_name,
      address_street: sa.address_street,
      address_city: sa.address_city,
      address_postal_code: sa.address_postal_code,
      address_country: sa.address_country,
      latitude: sa.latitude,
      longitude: sa.longitude,
      phone: sa.phone,
      website: sa.website,
      description: sa.description,
      vanity_url: vanityUrl,
    },
    update: {
      display_name: sa.display_name,
      pricing_plan: PricingPlanValue.FREE,
      payment_status: PaymentStatusValue.UNPAID,
      account_status: AccountStatusValue.ACTIVE,
      business_name: sa.business_name,
      address_street: sa.address_street,
      address_city: sa.address_city,
      address_postal_code: sa.address_postal_code,
      address_country: sa.address_country,
      latitude: sa.latitude,
      longitude: sa.longitude,
      phone: sa.phone,
      website: sa.website,
      description: sa.description,
      vanity_url: vanityUrl,
    },
  });

  // 3. Restore gallery records (with colors/traits junction tables)
  // Batched in chunks of 10 — color/trait junctions parallelized within each record.
  if (!sa.gallery_record || sa.gallery_record.length === 0) {
    return 0;
  }

  const [colorRows, traitRows] = await Promise.all([
    tx.color.findMany({ select: { id: true } }),
    tx.trait.findMany({ select: { id: true } }),
  ]);
  const allColorIds = new Set(colorRows.map(c => c.id));
  const allTraitIds = new Set(traitRows.map(t => t.id));

  // DECISION: an over-quota gallery after restore is intended (the returning user's portfolio is kept
  // above the FREE limit). Self-correcting: gallery-create.operation.ts enforces the limit on new
  // uploads, so nothing new is added until upgrade or delete.
  const restoredCount = await restoreGalleryRecords(
    tx,
    restoredAccount.account_id,
    sa.gallery_record,
    allColorIds,
    allTraitIds
  );
  // DECISION: restoreGalleryRecords uses raw tx.galleryRecord.create(), which bypasses
  // createGalleryRecord_IO's increment side effect, so cached_gallery_count is set explicitly in the same
  // tx.
  if (restoredCount > 0) {
    await tx.stylistAccount.update({
      where: { account_id: restoredAccount.account_id },
      data: { cached_gallery_count: restoredCount },
      select: { account_id: true },
    });
  }
  return restoredCount;
};

/**
 * Step 4: Upsert ClientAccount from backup data.
 */
const restoreClientAccount = async (
  tx: TxClient,
  userId: string,
  backup: DeletedUserBackup
): Promise<void> => {
  const ca = backup.client_account;
  if (!ca) {
    return;
  }

  // Upsert: idempotent to avoid P2002 unique constraint error
  await tx.clientAccount.upsert({
    where: { created_by_user_id: userId },
    create: {
      created_by_user_id: userId,
      contact_phone: ca.contact_phone,
      contact_email: ca.contact_email,
    },
    update: {
      contact_phone: ca.contact_phone,
      contact_email: ca.contact_email,
    },
  });
};

// DECISION: `checkRecoveryAvailability` was removed. A per-email lookup (scanning DeletedUser and
// returning deleted_at/days_left) was an account-enumeration vector on the public check-recovery
// endpoint. In Model A recovery is post-login: state is read from `currentUser` (recovery_available +
// deleted_at) and the public endpoint returns a uniform response. The remaining helpers stay for the
// legacy `restoreAccountFromBackup` (historical hard-delete JSON backups).

/**
 * Restore a user's account from backup.
 * Called after re-login (user already has a new User record via Better Auth).
 *
 * Restores: user fields, stylist account (with gallery records + colors/traits), client account.
 */
export const restoreAccountFromBackup = async ({
  userId,
  userEmail,
}: {
  userId: string;
  userEmail: string;
}): Promise<{
  success: boolean;
  restored_account_type: AccountType | null;
  gallery_records_restored: number;
}> => {
  const cutoff = getRecoveryCutoffDate();

  // Find matching backup — email-column fast path first, legacy JSON scan second.
  // The fast-path row still goes through findMatchingBackup (single-element list):
  // it re-validates the body shape (isDeletedUserBackup) and the body.email parity,
  // so a row with a matching column but corrupt/mismatched body is rejected the
  // same way the legacy scan would reject it.
  // DECISION: lookup and transaction are wrapped in try/catch with reportIssueBackend (operation
  // attribution) and a re-throw. The re-throw keeps the existing 500 path of HTTPRequestHandlerMiddleware:
  // the return shape ({success,...}) has no error channel (success:false means "no backup" -> 404).
  let match: ReturnType<typeof findMatchingBackup>;
  try {
    const emailRow = await findRecoverableBackupByEmail({
      email: userEmail,
      cutoff,
    });
    match = emailRow ? findMatchingBackup(userEmail, [emailRow]) : null;

    if (!match) {
      // Legacy rows (email column = NULL) — bounded JSON scan.
      const deletedUsers = await loadRecentRecoverableBackups({
        cutoff,
        limit: 100,
      });
      match = findMatchingBackup(userEmail, deletedUsers);
    }
  } catch (error) {
    reportIssueBackend({
      namespace: 'RECOVERY',
      message: `recovery backup lookup failed: ${error instanceof Error ? error.message : String(error)}`,
      payload: null,
      mode: 'error',
    });
    throw error;
  }

  if (!match) {
    return {
      success: false,
      restored_account_type: null,
      gallery_records_restored: 0,
    };
  }

  // Restore runs only on a fresh account. The update branch of the upsert below
  // unconditionally writes pricing_plan FREE, payment_status UNPAID and the
  // profile fields from the old backup. On a live paid account (same email
  // re-registered within 90 days of hard-delete, then POST to the legacy
  // endpoint) that would set the database to FREE while Stripe still bills, and
  // would set cached_gallery_count to restoredCount, which is right only when
  // the gallery is empty. Fresh means FREE, no subscription, and an empty
  // gallery (a bare dev-login account passes; that is why the upsert exists).
  // Rejection is success false and 404 RECOVERY_NOT_FOUND, the same as a missing
  // backup, so there is no new enumeration channel.
  const liveStylistAccount = await DB.stylistAccount.findUnique({
    where: { created_by_user_id: userId },
    select: {
      pricing_plan: true,
      subscription_id: true,
      cached_gallery_count: true,
    },
  });
  if (
    liveStylistAccount &&
    (liveStylistAccount.pricing_plan !== PricingPlanValue.FREE ||
      liveStylistAccount.subscription_id !== null ||
      liveStylistAccount.cached_gallery_count > 0)
  ) {
    reportIssueBackend({
      namespace: 'RECOVERY',
      message:
        'restoreAccountFromBackup refused: live stylist account is not fresh (paid plan, subscription or gallery present) — legacy restore would overwrite it',
      payload: {
        userId,
        pricingPlan: liveStylistAccount.pricing_plan,
        hasSubscription: liveStylistAccount.subscription_id !== null,
        cachedGalleryCount: liveStylistAccount.cached_gallery_count,
      },
      mode: 'warn',
    });
    return {
      success: false,
      restored_account_type: null,
      gallery_records_restored: 0,
    };
  }

  const { backup, deletedUserId } = match;
  let galleryRecordsRestored = 0;
  let alreadyRecovered = false;

  // Use a transaction for atomicity
  // DECISION: timeout 30_000 ms. Users with 100+ gallery records restore in chunks of 10
  // (restoreGalleryRecords), each creating records plus 2 createMany for the color/trait junctions;
  // Prisma's default 5s fires prematurely for power users, and 30s covers ~300 records with headroom.
  try {
    await DB.$transaction(
      async tx => {
        // 0. Idempotency claim: atomic update with `recovered_at IS NULL` guard.
        //    Concurrent calls race here — only one wins. Loser sees count=0 and
        //    aborts before non-idempotent gallery record inserts would duplicate.
        const claim = await tx.deletedUser.updateMany({
          where: { user_id: deletedUserId, recovered_at: null },
          data: {
            recovery_offered: true,
            recovered_at: new Date(),
            recovered_as_user_id: userId,
          },
        });

        if (claim.count === 0) {
          alreadyRecovered = true;
          return;
        }

        // 1. Restore user fields (name, image, role_id, account_type)
        await restoreUserFields(tx, userId, backup);

        // 2+3. Restore StylistAccount + gallery records
        if (backup.stylist_account) {
          galleryRecordsRestored = await restoreStylistAccount(
            tx,
            userId,
            backup
          );
        }

        // 4. Restore ClientAccount
        await restoreClientAccount(tx, userId, backup);
      },
      { timeout: 30_000 }
    );
  } catch (error) {
    reportIssueBackend({
      namespace: 'RECOVERY',
      message: `restoreAccountFromBackup transaction failed (user_id: ${userId}): ${error instanceof Error ? error.message : String(error)}`,
      payload: null,
      mode: 'error',
    });
    throw error;
  }

  if (alreadyRecovered) {
    return {
      success: false,
      restored_account_type: null,
      gallery_records_restored: 0,
    };
  }

  if (backup.stylist_account) {
    // DECISION: see salon-invitation-token.service.ts (a restored stylist account finishes her invitations).
    await finishAcceptedSalonInvitations(userId, 'archive restore');
  }
  return {
    success: true,
    restored_account_type: backup.account_type,
    gallery_records_restored: galleryRecordsRestored,
  };
};
