import { DB_CLIENT } from '@app/db/db.client';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type { PairingSessionNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { lockActivePair, lockStylistAccount } from '@app/db/lock-rows';
import { withWriteTx } from '@app/db/with-write-tx';
import { isDeadlock } from '@app/db/prisma-error';
import { decrementLikeCountFloored } from '@domain/favorites/operations/favorite-count.helper';
import { scheduleSessionVisitArchiveBestEffort } from '@domain/visit/operations/visit-session-archive.operations';

/**
 * Revoke permanent access (stylist removes client OR client removes stylist)
 */
export const revokePairingAccessCore_IO = async ({
  current_user_id,
  current_stylist_account_id,
  target_user_id,
  target_account_id,
}: {
  current_user_id: string;
  current_stylist_account_id?: string;
  target_user_id?: string;
  target_account_id?: string;
}): Promise<
  OperationResult<
    { success: true; revokedDirectClientUserId?: string | null },
    PairingSessionNotFoundError | DatabaseError
  >
> => {
  // Build OR conditions dynamically (avoid undefined in where)
  const orConditions = [];

  if (current_stylist_account_id && target_user_id) {
    orConditions.push({
      stylist_account_id: current_stylist_account_id,
      client_user_id: target_user_id,
    });
  }

  // DECISION: the client branch (a client revoking a stylist) is deliberately role-agnostic: it is NOT gated on the
  // active role, unlike the stylist branch (needs current_stylist_account_id). It is self-scoped by
  // client_user_id: current_user_id (always the caller), so there is no cross-tenant exposure / IDOR; a dual-role
  // user at most revokes her OWN client-side pairing, which is allowed. Do NOT add a role-purity guard
  // (account_type/role check) "for symmetry": it would block a legit self-revoke by a dual-role user for no
  // security gain.
  if (target_account_id) {
    orConditions.push({
      client_user_id: current_user_id,
      stylist_account_id: target_account_id,
    });
  }

  if (orConditions.length === 0) {
    return failure({
      type: 'PAIRING_SESSION_NOT_FOUND',
      sessionId: '',
    });
  }

  let pair;
  try {
    pair = await DB_CLIENT.use.clientStylistPair.findFirst({
      where: { status: PairingStatusValue.ACTIVE, OR: orConditions },
      select: {
        id: true,
        client_user_id: true,
        salon_origin_account_id: true,
        stylist_account_id: true,
      },
    });
  } catch (error) {
    return databaseFailure('revokePairingAccess', error);
  }

  // DECISION: revoke is IDEMPOTENT. No OWN ACTIVE row (already REVOKED after a first tap of "Zwolnij miejsce" /
  // "Rozłącz", a parallel request from a second device, an HTTP retry, PENDING, or a pair that never existed) gives
  // the SAME success with no side effects: the target state ("this relation is not active") is reached. A uniform
  // answer for "already cut" and "never was" is also zero oracle: success vs 404 would reveal (against a stylist's
  // public account_id) a former pair. Already-REVOKED used to give PAIRING_SESSION_NOT_FOUND, an error toast AFTER a
  // successful disconnect; UI in-flight guards stay as the first line. The cascade (favorites, sessions,
  // revoked_by) runs ONLY for an ACTIVE row, see below.
  if (!pair) {
    return success({ success: true });
  }

  // Sessions closed by the revoke are archived to VisitRecord AFTER the commit (see the DECISION where the ids
  // are collected below). Returned from the callback, never pushed from inside it: withWriteTx re-runs the
  // callback on a deadlock, so an outer side effect would be duplicated.
  let outcome: { revoked: boolean; sharedSessionIdsClosedByRevoke: string[] };

  // Cascade: delete favorites + soft-delete pair — atomically in a transaction
  try {
    outcome = await withWriteTx(
      async tx => {
        // DECISION: the stylist's account row is locked FIRST (global order, application/db/lock-order.ts;
        // this tx takes no User lock), the SAME lock addRecordToFavorites_IO takes before it
        // evaluates access. That serializes revoke with every like add on this stylist: a like committed first
        // is deleted below, a like arriving later re-reads the pair as REVOKED and is refused. Without it a
        // revoke committed while an add waited (with access already read) and the former client kept a private
        // asset_url (F1). The pair is re-read under the lock because the read above ran outside the tx; a
        // parallel revoke that won the lock leaves nothing to do (idempotent success, no second cascade).
        // withWriteTx(retryOn: isDeadlock) stays for hidden FK locks, as in removeRecordFromFavorites_IO.
        await lockStylistAccount(tx, pair.stylist_account_id);
        // DECISION: the pair row is locked HERE, right after the StylistAccount and BEFORE the sessions are
        // closed (order StylistAccount -> ClientStylistPair -> SessionContainer). The old order updated the
        // sessions first and the pair last, the reverse of the share path (pair upsert -> session update), a
        // deadlock with a share that re-activated the pair in between (LOCK_GRAPH.md C3). lockActivePair also
        // is the "still ACTIVE" re-check: null means a parallel revoke already won (same unique pair row as
        // pair.id, since (client, stylist) is @@unique and pairs are never hard-deleted while users exist).
        const stillActive = await lockActivePair(
          tx,
          pair.client_user_id,
          pair.stylist_account_id
        );
        if (!stillActive) {
          return { revoked: false, sharedSessionIdsClosedByRevoke: [] };
        }
        const sharedSessionIdsClosedByRevoke: string[] = [];

        // DECISION: the cached_likes_count decrement is GATED on the actual .count of deleteMany over VISIBLE rows,
        // not on a separate pre-count. The old form (count(is_hidden:false) -> deleteMany(is_pinned:false, both
        // visibilities) -> decrement = pre-count) raced under READ COMMITTED: a concurrent addRecordToFavorites_IO
        // committing a NEW VISIBLE like between the pre-count and deleteMany was deleted by deleteMany (it sees fresh
        // commits) but not counted, so cached_likes_count drifted +1 (bounded +1 per revoke). Now deletion is split by
        // visibility, as in removeRecordFromFavorites_IO (decrement gated on the real delete):
        // deleteMany(is_hidden:false).count = visible rows actually removed = the decrement; a second
        // deleteMany(is_hidden:true) removes likes of HIDDEN records WITHOUT a decrement (they were outside the
        // counter, which counts is_hidden=false only). Together they delete exactly the old set (all is_pinned:false).
        // Pinned likes (public) and bookmarks (FavoriteStylist) are kept: independent of pairing. The floor in
        // decrementLikeCountFloored is the last defence; the startup backfill repairs any drift.
        const deletedVisible = await tx.favoriteGalleryRecord.deleteMany({
          where: {
            client_user_id: pair.client_user_id,
            record: {
              created_by_account_id: pair.stylist_account_id,
              is_pinned: false,
              is_hidden: false,
            },
          },
        });

        // Single SoT writer: favorite-count.helper.ts owns cached_likes_count; decrement by the visible
        // rows the deleteMany ABOVE actually removed (its own .count — atomic with the delete, no pre-read).
        if (deletedVisible.count > 0) {
          await decrementLikeCountFloored(
            tx,
            pair.stylist_account_id,
            deletedVisible.count
          );
        }

        // Delete the HIDDEN unpinned favorites too (they must not survive the revoke), but with NO
        // decrement — their likes were never in cached_likes_count (SoT = visible records only).
        await tx.favoriteGalleryRecord.deleteMany({
          where: {
            client_user_id: pair.client_user_id,
            record: {
              created_by_account_id: pair.stylist_account_id,
              is_pinned: false,
              is_hidden: true,
            },
          },
        });

        // Close all non-terminal SessionContainers between this stylist and client
        const clientAccount = await tx.clientAccount.findUnique({
          where: { created_by_user_id: pair.client_user_id },
          select: { client_account_id: true },
        });
        if (clientAccount) {
          const NON_TERMINAL_STATES = [
            SessionContainerLifecycleStateValue.DRAFT,
            SessionContainerLifecycleStateValue.READY,
            SessionContainerLifecycleStateValue.SHARED,
            SessionContainerLifecycleStateValue.ACTIVE,
          ];
          // DECISION: revoke closes sessions by the SAME path as closeSessionContainer_IO, so it must also trigger its
          // CRM effect: every SHARED (shared_at != null) session closed here gets a VisitRecord. Otherwise a revoke
          // silently lost a visit that a plain "Zamknij sesję" on the same container would archive (the visit archive
          // survives revoke: VisitRecords persist), a real data loss. The ids are collected BEFORE updateMany (after it
          // the lifecycle predicate no longer matches), but archiving runs AFTER the commit: a VisitRecord is a
          // best-effort effect outside the revoke invariant (as in session-container-lifecycle), and the operation
          // reads state with a fresh query, so it must see the committed CLOSED.
          const closingSessions = await tx.sessionContainer.findMany({
            where: {
              client_account_id: clientAccount.client_account_id,
              stylist_account_id: pair.stylist_account_id,
              lifecycle_state: { in: NON_TERMINAL_STATES },
            },
            select: { id: true, shared_at: true },
          });
          sharedSessionIdsClosedByRevoke.push(
            ...closingSessions
              .filter(session => session.shared_at !== null)
              .map(session => session.id)
          );

          await tx.sessionContainer.updateMany({
            where: {
              client_account_id: clientAccount.client_account_id,
              stylist_account_id: pair.stylist_account_id,
              lifecycle_state: { in: NON_TERMINAL_STATES },
            },
            data: {
              lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
              closed_at: new Date(),
            },
          });
        }

        await tx.clientStylistPair.update({
          where: { id: pair.id },
          data: {
            status: PairingStatusValue.REVOKED,
            revoked_at: new Date(),
            // DECISION: the actor is decided by the MATCHED ROW, not the request shape. The first version looked at the
            // mere PRESENCE of `current_stylist_account_id`, i.e. the caller's active role, but this op has TWO branches
            // and the client branch is deliberately role-agnostic (a dual-role user must be able to unpair HER stylist,
            // see the DECISION above). So such a user unpaired her own stylist "as a stylist", the row got
            // `revoked_by=STYLIST` and the CAS REVOKED->PENDING blocked her return FOR GOOD: the one who pressed the
            // button was the victim of an irreversible cut-off, and the anti-oracle mask told her "no such stylist".
            revoked_by:
              pair.client_user_id === current_user_id
                ? AccountTypeValue.CLIENT
                : AccountTypeValue.STYLIST,
          },
        });
        return { revoked: true, sharedSessionIdsClosedByRevoke };
      },
      { retryOn: isDeadlock }
    );
  } catch (error) {
    return databaseFailure('revokePairingAccess', error);
  }

  if (!outcome.revoked) {
    return success({ success: true });
  }

  for (const session_id of outcome.sharedSessionIdsClosedByRevoke) {
    scheduleSessionVisitArchiveBestEffort({ session_id });
  }

  return success({
    success: true,
    revokedDirectClientUserId:
      pair.salon_origin_account_id === null ? pair.client_user_id : null,
  });
};
