import { DB_CLIENT } from '@app/db/db.client';
import type { IDType } from '@kernel/application/application.types';
import {
  AccountStatusValue,
  type AccountStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  assertType,
  isAccountStatusNarrower,
  narrowUser,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { USER_POLICY } from '@kernel/policies/user.policy';
import {
  userRelationsEnabler,
  userRelationsArchiveEnabler,
} from '@domain/user/user.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  UserNotFoundError,
  AccountNotRecoverableError,
} from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { RECOVERY_CONFIG } from '@kernel/domain/recovery/deleted-user-backup.types';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';
import { decrementLikesForDeletedClient } from '@domain/favorites/operations/favorite-count.helper';
import { decrementBookmarksForDeletedClient } from '@domain/favorites/operations/bookmark-count.helper';
import { cancelStripeSubscriptionIfExists } from '@app/stripe/customer.operations';

/**
 * ADRR Model A — Account soft-delete + reactivation operations (§13.1).
 *
 * Three account lifecycle transitions live here, kept SEPARATE from:
 *  - `disableUser_IO` (user-state.operations.ts) — admin-ban (deleted_at=null).
 *  - `restoreAccountFromBackup` (recovery/recovery.operations.ts) — legacy
 *    JSON-restore onto a NEW record (historical hard-deletes only).
 *  - `deleteUser_IO` (user-crud.operations.ts) — hard-delete + JSON backup,
 *    repurposed as the GDPR-erasure primitive (see gdprEraseAccount_IO).
 *
 * State machine (§13.1):
 * | State        | is_active | deleted_at | recovery_available |
 * | ACTIVE       | true      | null       | false              |
 * | RECOVERABLE  | false     | set        | true               |
 * | EXPIRED      | false     | set        | false              |
 * | ADMIN-DISABLED| false    | null       | false              |
 *
 * RECOVERABLE vs ADMIN-DISABLED differ ONLY by deleted_at (set vs null).
 */

/**
 * Soft-delete the current user's own account (self-delete completion).
 *
 * Sets is_active=false, deleted_at=now(), recovery_available=true and clears
 * all active sessions (logs the user out everywhere). Data stays IN PLACE
 * (gallery, pairs, likes) so a later reactivation restores the account 1:1.
 * Deliberately does NOT write a JSON backup — that is the GDPR-erasure path.
 *
 * Returns `null` (idempotent no-op) when the account was NOT ACTIVE at call
 * time — see the compare-and-set guard below. Callers MUST treat null as
 * "nothing to soft-delete" and not synthesize a fresh deletion.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Guard = updateMany WHERE id AND is_active=true (atomic compare-and-set,
 * mirror reactivateAccount_IO). count=0 → konto JUŻ nie jest ACTIVE
 * (RECOVERABLE / EXPIRED / ADMIN-DISABLED) albo nie istnieje → zwracamy null
 * (no-op), NIE re-armujemy recovery_available i NIE resetujemy deleted_at.
 * To zamyka dwa defekty replayu delete-confirm tokenu (QA user-lifecycle-1/2):
 *  (1) replay na już-RECOVERABLE koncie NIE odświeża deleted_at (brak kill-loop),
 *  (2) replay na już-nieaktywnym koncie NIE wskrzesza recovery_available (okno 90d
 *      pozostaje terminalne — zgodnie z account-state-guard "okno minęło").
 * Nested stylist-status + session-clear robione W TEJ SAMEJ transakcji DOPIERO
 * po wygranym claimie (updateMany nie wspiera nested relation writes).
 *
 * DECISION (nie usuwaj tego komentarza):
 * disabled_at pozostaje null (NIE ustawiamy go). To ono rozróżnia soft-delete
 * (deleted_at set, disabled_at null) od admin-ban (disabled_at set, deleted_at
 * null) na poziomie danych — patrz disableUser_IO. account_status stylisty →
 * NOT_ACTIVE (spójnie z disable: nieaktywny user nie ma ACTIVE konta), ale
 * reaktywacja przywróci je przez CAN_USER_HAVE_ACTIVE_ACCOUNT.
 */
export const softDeleteAccount_IO = async (
  passedUser: UserWithRelations
): Promise<
  OperationResult<UserWithRelations | null, UserNotFoundError | DatabaseError>
> => {
  let userRaw: UserWithRelations | null;
  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      // Atomic compare-and-set: only an ACTIVE row transitions to RECOVERABLE.
      const claim = await tx.user.updateMany({
        where: { id: passedUser.id, is_active: true },
        data: {
          is_active: false,
          deleted_at: new Date(),
          recovery_available: true,
        },
      });

      if (claim.count === 0) {
        // Already inactive (RECOVERABLE/EXPIRED/ADMIN-DISABLED) or missing.
        // No-op: do not re-arm recovery or reset the deletion clock.
        return null;
      }

      // Stylist account_status → NOT_ACTIVE (nested write needs the dedicated
      // call; updateMany above cannot touch the relation).
      if (passedUser.stylist_account) {
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: passedUser.id },
          data: {
            account_status: assertType(
              AccountStatusValue.NOT_ACTIVE,
              isAccountStatusNarrower,
              'NOT_ACTIVE status'
            ),
          },
        });
      }

      // Log the user out everywhere.
      await tx.session.deleteMany({ where: { userId: passedUser.id } });

      const fresh = await tx.user.findUnique({
        where: { id: passedUser.id },
        include: userRelationsEnabler,
      });
      return fresh
        ? narrowUser<UserWithRelations>(fresh, 'softDeleteAccount_IO:fresh')
        : null;
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
    }
    return databaseFailure('softDeleteAccount_IO', error);
  }

  // Eviction cleanup: if the soft-deleted user was a mid-impersonation admin,
  // tear down the orphaned impersonated (target) session + ImpersonationBackup.
  // Best-effort, outside the tx — failure must never block the soft-delete.
  // Mirror of deleteAllSessionsOfUser_IO (user-session.operations.ts ~line 330).
  await revokeImpersonationOnEviction(passedUser.id);

  // null === idempotent no-op (account was not ACTIVE). Surface as success(null)
  // so the caller can short-circuit without re-killing a recovered account.
  return success(userRaw);
};

/**
 * Reactivate a soft-deleted (RECOVERABLE) account IN PLACE (post-login, 1-click).
 *
 * Sets is_active=true, deleted_at=null, recovery_available=false. Account returns
 * to its pre-deletion state — plan, gallery, settings are NOT reset (data was
 * never removed). Idempotency + authorization guard: the update is scoped with
 * `recovery_available=true AND disabled_at=null`, so EXPIRED (window passed),
 * ADMIN-DISABLED (ban), banned-while-recoverable (soft-delete → admin-ban hybrid)
 * and already-ACTIVE rows cannot be reactivated — they hit count=0 → error.
 *
 * userId MUST come from the authenticated session (currentUser.id), never body.
 */
export const reactivateAccount_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<
  OperationResult<
    UserWithRelations,
    UserNotFoundError | AccountNotRecoverableError | DatabaseError
  >
> => {
  try {
    // DECISION (nie usuwaj tego komentarza):
    // Guard = updateMany WHERE id AND recovery_available=true AND disabled_at=null
    // (atomic compare-and-set). count=0 oznacza: konto nie jest RECOVERABLE
    // (expired/ban/active), MA aktywny admin-ban, ALBO nie istnieje →
    // ACCOUNT_NOT_RECOVERABLE. Eliminuje race (równoległe reactivate) i
    // blokuje reaktywację stanów innych niż czysty RECOVERABLE. account_status stylisty
    // ustawiany w osobnym kroku (updateMany nie wspiera nested relation writes),
    // wewnątrz $transaction dla atomowości z flipem flag.
    //
    // DECISION (nie usuwaj tego komentarza):
    // delete_confirm_version++ przy KAŻDEJ reaktywacji (QA user-lifecycle-1 signal #2,
    // defense-in-depth). Bumpa wersji unieważnia WSZELKIE pending delete-confirm tokeny
    // (mintowane przy poprzednim USER_REQUEST_DELETE) — replay starego, wciąż ważnego
    // (≤24h) linku PO powrocie konta do ACTIVE trafia na mismatch wersji w
    // confirmDeleteSelf_IO i jest odrzucany, więc reaktywacja nie może być cofnięta
    // przez replay. Atomowe z flipem flag (ten sam updateMany).
    const reactivated = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION (nie usuwaj tego komentarza):
      // recovery_available=true to JEDYNA bramka reaktywacji — okno 90d (RECOVERY_CONFIG.MAX_DAYS,
      // .shared-kernel/domain/recovery/deleted-user-backup.types.ts) NIE jest tu re-sprawdzane
      // (brak warunku na deleted_at). To BY DESIGN, nie przeoczenie (QA flaguje to cyklicznie).
      // Granicę 90d egzekwuje WYŁĄCZNIE cron MOVE (recovery-expiry.interceptor →
      // expireMoveRecoveryWindows_IO → moveExpiredUserToArchive_IO), który po wygaśnięciu okna
      // hard-deletuje wiersz (model MOVE-only: BRAK flip-flopu recovery_available→false; stan
      // EXPIRED nie jest już produkowany — patrz DECISION w account-state-guard.ts). Skoro flagi
      // nie da się zgasić bez skasowania wiersza, recovery_available=true ⇒ konto jest w oknie.
      // Konsekwencja: do ≤24h opóźnienia sweepu (batch 50/24h) konto pozostaje reaktywowalne mimo
      // formalnego przekroczenia 90d — to ZAMIERZONY efekt modelu MOVE-only (delete = jedyne
      // wyjście z RECOVERABLE), spójny z account-state-guard ("okno minęło" = wiersz już usunięty),
      // a nie luka do "naprawienia" dodatkowym warunkiem deleted_at.
      // DECISION (nie usuwaj tego komentarza):
      // SECURITY: disabled_at:null OBOWIĄZKOWO w WHERE — recovery NIE MOŻE zdejmować
      // admin-bana. Hybryda RECOVERABLE+ban (is_active=false, deleted_at set,
      // recovery_available=true, disabled_at set) powstaje przez soft-delete → admin-ban
      // (disableUser_IO i moderation-BAN CAS-ują tylko WHERE disabled_at:null, NIE ruszają
      // deleted_at/recovery_available; kierunek odwrotny ban → self-delete jest zablokowany
      // CAS-em softDeleteAccount_IO WHERE is_active:true). account-state-guard klasyfikuje
      // hybrydę po deleted_at jako RECOVERABLE i przepuszcza USER_REACTIVATE_ACCOUNT do tej
      // operacji — bez warunku disabled_at:null user self-service ZDEJMOWAŁ bana (dawny
      // data-block czyścił disabled_at). Teraz hybryda trafia count=0 →
      // ACCOUNT_NOT_RECOVERABLE (ta sama odpowiedź co expired/active — kontrakt
      // anty-enumeracyjny zachowany). Wyjście z hybrydy: brak self-service; po 90d MOVE
      // (moveExpiredUserToArchive_IO) archiwizuje wiersz jak każdy RECOVERABLE.
      //
      // DECISION (nie usuwaj tego komentarza):
      // disabled_at:null w data-blocku ZOSTAJE jako belt-and-suspenders koherencji —
      // dopasowany wiersz ma już disabled_at=null (WHERE wyżej), ale reaktywacja MUSI
      // produkować KOHERENTNY stan ACTIVE (is_active=true ⇒ disabled_at=null, parytet ze
      // state-machine §13.1 i z enableUser_IO/admin-bulk-enable, które czyszczą disabled_at
      // lockstep). Hybryda is_active=true + disabled_at!=null byłaby niewidoczna dla
      // konsumentów filtrujących (is_active:true AND disabled_at:null): salon-staff invite
      // lookup → cichy STAFF_ALREADY_EXISTS; email-change confirm stateGuard → INVALID_TOKEN.
      const claim = await tx.user.updateMany({
        where: { id, recovery_available: true, disabled_at: null },
        data: {
          is_active: true,
          disabled_at: null,
          deleted_at: null,
          recovery_available: false,
          delete_confirm_version: { increment: 1 },
        },
      });

      if (claim.count === 0) {
        return null;
      }

      const fresh = await tx.user.findUnique({
        where: { id },
        include: userRelationsEnabler,
      });
      const narrowedFresh = fresh
        ? narrowUser<UserWithRelations>(fresh, 'reactivateAccount_IO:fresh')
        : null;

      // Re-activate stylist account_status (mirror enableUser_IO policy gate).
      if (narrowedFresh?.stylist_account) {
        const nextStatus: AccountStatus | undefined =
          USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT({
            user: narrowedFresh,
          })
            ? assertType(
                AccountStatusValue.ACTIVE,
                isAccountStatusNarrower,
                'ACTIVE status'
              )
            : undefined;
        if (nextStatus) {
          await tx.stylistAccount.updateMany({
            where: { created_by_user_id: id },
            data: { account_status: nextStatus },
          });
          // Reflect the status change on the object we return.
          narrowedFresh.stylist_account.account_status = nextStatus;
        }
      }

      return narrowedFresh;
    });

    if (reactivated === null) {
      return failure({ type: 'ACCOUNT_NOT_RECOVERABLE', userId: id });
    }

    return success(reactivated);
  } catch (error: unknown) {
    return databaseFailure('reactivateAccount_IO', error);
  }
};

/**
 * MOVE a single expired soft-deleted account into the permanent DeletedUser archive.
 *
 * After RECOVERY_CONFIG.MAX_DAYS (90d) the account leaves the operational tables: a full
 * snapshot (user + cascade-deleted satellites via userRelationsArchiveEnabler) is written to
 * DeletedUser.body, then the User row is DELETED (email freed). The archive is NON-restorable
 * (is_move_archive=true; loadRecentRecoverableBackups excludes it).
 * Soft-FK rows (EventLog/ContactAccessLog/SupportThread) stay in their own tables with a dangling
 * user_id; email-keyed NewsletterSubscriber has no FK to User and is not touched by this path.
 *
 * Mirrors deleteUser_IO (P2025 mapping, JSON normalize, SAME userRelationsArchiveEnabler, same
 * body shape). Różni je TYLKO marker: MOVE ustawia
 * is_move_archive=true (terminal po 90d), deleteUser_IO ustawia is_gdpr_erased=true (terminal na
 * żądanie). Oba markery wykluczają wiersz z recovery.
 *
 * Idempotent under concurrent instances: returns { moved: false } when the row was already gone
 * (the losing tx hits P2025 on user.delete -> the whole atomic snapshot+delete rolls back, so
 * exactly one archive is written).
 *
 * DECISION (nie usuwaj tego komentarza):
 * MOVE nie woła cleanupCloudinaryAssets. asset_urls zostają w body archiwum i są JEDYNYM zapisem
 * tego, gdzie leżą pliki. Sprząta je admin hard-purge wiersza DeletedUser (Art.17), który czyta
 * adresy z body i dopiero wtedy woła cleanupCloudinaryAssets(asset_urls). NIE dodawać
 * automatycznego cleanup do MOVE: sprzątanie plików należy do purge. Soft-FK rows
 * (EventLog/ContactAccessLog/SupportThread) i email-keyed NewsletterSubscriber zostają we
 * własnych tabelach. (Anti-enumeracja zachowana osobno:
 * MOVE/hard-delete ZWALNIA email przez user.delete → re-rejestracja po oknie jest czysta.)
 */
export const moveExpiredUserToArchive_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<OperationResult<{ moved: boolean }, DatabaseError>> => {
  try {
    const snapshot = await DB_CLIENT.use.user.findUnique({
      where: { id },
      include: userRelationsArchiveEnabler,
    });

    if (!snapshot) {
      // Already moved/deleted by a concurrent instance — idempotent skip.
      return success({ moved: false });
    }

    // Fail-safe Stripe cancel (census 2026-07-09): MOVE to JEDYNA ścieżka
    // trwałego usunięcia, która nie wołała cancelStripeSubscriptionIfExists
    // (self-GDPR, self-confirm i admin-delete wołają). Jeśli best-effort cancel
    // przy soft-delete padł i alert przeoczono przez 90 dni, subskrypcja
    // bilingowałaby ducha bez konta i kanału kontaktu. Helper jest never-throw
    // (loguje + critical alert, kontynuuje delete) i no-op bez subskrypcji.
    await cancelStripeSubscriptionIfExists(id);

    await DB_CLIENT.use.$transaction(async tx => {
      // Normalize Prisma 7 TaggedDateTime ({$type,value}) -> plain ISO (same as deleteUser_IO).
      const normalizedBody = JSON.parse(JSON.stringify(snapshot)) as object;

      // Permanent RAW archive (NON-restorable). is_move_archive set from the start so a crash
      // between upsert and delete never leaves a "restorable" half-archive.
      await tx.deletedUser.upsert({
        where: { user_id: id },
        update: {
          body: normalizedBody,
          email: snapshot.email,
          is_move_archive: true,
        },
        create: {
          user_id: id,
          body: normalizedBody,
          email: snapshot.email,
          is_move_archive: true,
        },
      });

      // Target-side impersonation backup cleanup (mirror deleteUser_IO; idempotent count=0).
      await tx.impersonationBackup.deleteMany({
        where: { impersonated_user_id: id },
      });

      // CLIENT HARD-DELETE CASCADE drift fix (mirror deleteUser_IO; finding spar/user-cascade):
      // FavoriteGalleryRecord.client_user_id has onDelete:Cascade, so the tx.user.delete below
      // removes this client's likes at the DB level WITHOUT routing through the cached_likes_count
      // write-path. Decrement every affected stylist's counter (visible likes only) in the SAME tx,
      // BEFORE the delete — afterwards the FavoriteGalleryRecord rows are already gone. The user id
      // (= client_user_id) is the join key; independent of the recovery_available delete guard.
      await decrementLikesForDeletedClient(tx, id);
      // Bookmark sibling (CWT-1, mirror deleteUser_IO): FavoriteStylist.client_user_id
      // onDelete:Cascade ALSO bypasses cached_bookmark_count — decrement BEFORE the delete.
      await decrementBookmarksForDeletedClient(tx, id);

      // DELETE the User row -> email freed. Cascade removes StylistAccount/gallery/client/
      // favorites/pairings/staff/strikes/accounts/sessions. Soft-FK rows survive (raw user_id).
      // Guard recovery_available=true: closes the SELECT-then-delete race with
      // reactivateAccount_IO (which flips recovery_available=false). If reactivation
      // won between the batch SELECT and here, this delete hits P2025 -> the whole tx
      // (incl. the archive upsert) rolls back, so a reactivated ACTIVE account is never
      // archived/deleted on a stale snapshot.
      await tx.user.delete({ where: { id, recovery_available: true } });
    });

    return success({ moved: true });
  } catch (error: unknown) {
    if (isP2025(error)) {
      // Concurrent instance won the delete — atomic rollback of this tx, no double-move.
      return success({ moved: false });
    }
    return databaseFailure('moveExpiredUserToArchive_IO', error);
  }
};

/**
 * Batch MOVE: archive soft-deleted accounts past the 90d recovery window.
 *
 * Replaces the legacy flip-only expireRecoveryWindows_IO. Processes up to BATCH=50 per run
 * (per-row tx cost is high — full snapshot + cascade delete). Per-row failures are tolerated
 * (logged via databaseFailure inside moveExpiredUserToArchive_IO) so one bad row never aborts
 * the batch; backlog catches up on the next sweep.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Concurrent-instance safety = per-row idempotency (moveExpiredUserToArchive_IO zwraca moved:false
 * na P2025), NIE advisory lock. Dwie instancje mogą trafić te same wiersze; wygrywa jedna (atomic
 * upsert+delete), przegrana dostaje P2025 i pomija. Batch 50/24h.
 * Index @@index([recovery_available, deleted_at]).
 *
 * Recovery-vs-move race: NIE wystarcza batch-level `where recovery_available=true` (poniżej) — między
 * tym SELECT a delete'em w moveExpiredUserToArchive_IO user może się zalogować i zreaktywować konto
 * (reactivateAccount_IO atomowo flip recovery_available=false, is_active=true). Race ZAMYKA dopiero
 * guard `WHERE id AND recovery_available=true` na samym `tx.user.delete` (TAM, nie tu): gdy reaktywacja
 * wygra TOCTOU, delete trafia P2025 → cała tx (z upsertem archiwum) rolluje back → reaktywowane ACTIVE
 * konto nie zostaje zarchiwizowane/skasowane na stale snapshocie. Sam ten batch-filter to fast-path.
 */
export const expireMoveRecoveryWindows_IO = async (): Promise<
  OperationResult<{ moved: number }, DatabaseError>
> => {
  try {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - RECOVERY_CONFIG.MAX_DAYS);

    const expired = await DB_CLIENT.use.user.findMany({
      where: {
        recovery_available: true,
        deleted_at: { lt: cutoff },
      },
      select: { id: true },
      take: 50,
    });

    let moved = 0;
    for (const { id } of expired) {
      const result = await moveExpiredUserToArchive_IO({ id });
      if (result.success && result.data.moved) {
        moved += 1;
      }
    }

    return success({ moved });
  } catch (error: unknown) {
    return databaseFailure('expireMoveRecoveryWindows_IO', error);
  }
};
