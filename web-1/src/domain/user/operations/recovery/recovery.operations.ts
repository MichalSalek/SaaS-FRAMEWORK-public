import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
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

/**
 * Recoverable-set filter shared by the email-column fast path and the legacy
 * JSON-scan fallback — the two lookups MUST agree on what "recoverable" means.
 *
 * DECISION (nie usuwaj tego komentarza):
 * is_gdpr_erased=true => backup pochodzi z Art.17 erasure (gdpr-erase),
 * NIE z odzyskiwalnego soft-delete. MUSI być wykluczony z recoverable set,
 * inaczej restoreAccountFromBackup odwraca erasure 1:1 (QA user-lifecycle-3).
 * `not: true` (zamiast `false`) jest defensywne wobec starych rekordów z NULL
 * sprzed dodania kolumny — traktuje brak-flagi jak recoverable (zgodnie z
 * intencją: pre-erasure backupy były odzyskiwalne).
 *
 * DECISION (nie usuwaj tego komentarza):
 * is_move_archive=true => archiwum z 90d MOVE: pełne body, ale NIE restorable.
 * MUSI być wykluczone — lookup dopasowuje po emailu, więc re-rejestracja na ten
 * sam (zwolniony) email mogłaby wskrzesić przeniesione konto ("nigdy go nie było"). `not: true`
 * defensywnie wobec starych NULL sprzed kolumny (legacy hard-delete backupy = restorable).
 */
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
 * DECISION (nie usuwaj tego komentarza):
 * `mode: 'insensitive'` mirrors the legacy scan's toLowerCase() comparison
 * (Better Auth normally stores emails lowercased already, so this is a
 * belt-and-suspenders parity, not a hot path for mixed-case). It costs the
 * plain btree index for THIS query (lower() comparison) — acceptable at
 * DeletedUser row counts; when the writers start persisting the column
 * normalized (normalizeEmail), this can flip to exact `equals` and use the index.
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
 * DECISION (nie usuwaj tego komentarza):
 * `email: null` restricts the JSON scan to legacy rows ONLY — rows with the
 * column populated are already covered (and rejected/matched) by the fast path
 * above, so re-scanning them would only waste parses. Backward-compat is cheap
 * and kept even though pre-production DBs may be reset (a stale legacy row must
 * never silently lose its recovery window). Pre-launch pragmatic: 100-row cap +
 * JSON parse is fine at <100 legacy backups.
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

  // Check if vanity_url was claimed by another user during deletion period
  // DECISION (nie usuwaj tego komentarza): TOCTOU check→upsert świadomie tolerowany.
  // Graceful drop poniżej pokrywa happy-path (vanity zajęty PRZED recovery). Mikro-okno
  // między tym findUnique a upsert, w którym INNY user claimowałby DOKŁADNIE ten sam vanity,
  // dałoby P2002 → 500. Skrajnie rzadkie (recovery = rzadki flow + równoległy claim tego
  // samego vanity w oknie ms) i samonaprawialne: ponowne recovery złapie już-zajęty vanity
  // i go zdropuje. Pełne domknięcie wymagałoby restartu interaktywnej tx po P2002 (Prisma
  // abortuje całą tx na błędzie) — over-engineering dla tej ścieżki.
  let vanityUrl = sa.vanity_url;
  if (vanityUrl) {
    const vanityConflict = await tx.stylistAccount.findUnique({
      where: { vanity_url: vanityUrl },
      select: { created_by_user_id: true },
    });
    if (vanityConflict && vanityConflict.created_by_user_id !== userId) {
      vanityUrl = null; // Another user claimed this vanity_url — drop it
    }
  }

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

  // DECISION (nie usuwaj tego komentarza): over-quota grandfather po restore jest
  // zamierzony — zachowanie portfolio wracającego usera > limit FREE. Stan
  // self-correcting: gallery-create.operation.ts egzekwuje limit na nowych uploadach,
  // więc brak nowych dodań do upgrade/delete.
  const restoredCount = await restoreGalleryRecords(
    tx,
    restoredAccount.account_id,
    sa.gallery_record,
    allColorIds,
    allTraitIds
  );
  // DECISION (D7+DD3-D1 run 24): restoreGalleryRecords uses raw tx.galleryRecord.create()
  // (bypasses createGalleryRecord_IO's increment side-effect). Set cached_gallery_count
  // explicitly in the same tx for atomic consistency.
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

// DECISION (nie usuwaj tego komentarza):
// ADRR Model A (§13.1) — `checkRecoveryAvailability` USUNIĘTE. Per-email lookup
// (skanowanie DeletedUser po emailu i zwracanie deleted_at/days_left) był wektorem
// account-enumeration na publicznym endpoincie check-recovery. W Model A recovery jest
// POST-login: stan czyta się z `currentUser` (SafeCurrentUser: recovery_available +
// deleted_at), a publiczny endpoint zwraca uniform response (zero ujawniania per-email).
// Helpery loadRecentRecoverableBackups/findMatchingBackup/getRecoveryCutoffDate zostają —
// używa ich legacy `restoreAccountFromBackup` (historyczne hard-delete'y JSON).

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
  // DECISION (nie usuwaj tego komentarza): lookup i transaction owinięte w try-catch z
  // reportIssueBackend (atrybucja operacji) i re-throw. Re-throw zachowuje istniejącą ścieżkę
  // 500 z HTTPRequestHandlerMiddleware — return shape ({success,...}) NIE ma kanału błędu
  // (success:false znaczy "brak backupu" → 404, nie błąd DB). Guard daje precyzyjny log
  // (backup-lookup vs restoreAccountFromBackup) bez regresji statusu/shape.
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

  // FRESH-ACCOUNT PRECONDITION (census 2026-07-09): restore wolno wykonać tylko
  // na świeże konto. Update-branch upsertu niżej BEZWARUNKOWO nadpisuje
  // pricing_plan→FREE, payment_status→UNPAID i dane profilowe starym backupem —
  // wywołany na ŻYWYM, opłaconym koncie (re-rejestracja tym samym emailem w ≤90d
  // po hard-delete + POST na legacy endpoint) degradowałby DB do FREE, gdy Stripe
  // dalej bilinguje, i desynchronizowałby cached_gallery_count (ustawiany niżej
  // NA restoredCount, co jest poprawne wyłącznie przy zerowej galerii). Konto
  // „świeże" = FREE + bez subskrypcji + pusta galeria (bare-bones konto z
  // dev-login przechodzi — po to upsert istnieje). Odrzucenie → success:false
  // → 404 RECOVERY_NOT_FOUND (jak brak backupu; zero nowego kanału enumeracji).
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
  // DECISION (nie usuwaj tego komentarza):
  // timeout: 30_000ms — users with 100+ gallery records restore in chunks of 10 (restoreGalleryRecords),
  // each chunk creates records + 2 createMany for color/trait junctions (parallelised). Default Prisma 5s
  // fires prematurely for power users. 30s covers ~300 gallery records worst-case with headroom.
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

  return {
    success: true,
    restored_account_type: backup.account_type,
    gallery_records_restored: galleryRecordsRestored,
  };
};
