import { lockSessionActivityContext } from '../session-activity.lock';
import { writeSessionActivity } from '../session-activity.write';
import { canUseSalonPhotoInSession_IO } from '@domain/pairing/salon-access.resolver';
/**
 * SessionContainer ADD-PHOTO operation (R8)
 *
 * Split from session-container-commands.operations.ts to stay under ESLint
 * max-lines (350). Mirrors the 1:1 split pattern of session-container-share.operation.ts.
 * Behaviour is identical to the pre-split commands file — idempotent insert,
 * CAS position retry, in-TX lifecycle re-check, stylist lock-in.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { failure } from '@kernel/application/result.types';
import type {
  SessionContainerPairSessionExistsError,
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
  SessionContainerNotPairedError,
  SessionContainerPhotoOwnershipError,
  SessionContainerInvalidStateError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  toDtoLifecycleState,
  isClosedOrExpired,
  isPastTtl,
  findActivePairing,
} from './session-container-shared.operations';
import { loadSessionDetail_IO } from './session-container-queries.operations';
import {
  assertNoOtherOpenPairSession,
  findOtherOpenPairSessionId,
  PairSessionExistsInTxError,
} from './session-container-pair-session.helper';
import {
  isConcurrencyConflict,
  classifyUniqueConstraintViolation,
  isP2002,
} from './session-container-concurrency.helper';

/**
 * Sentinel thrown inside the add-photo $transaction when the session was
 * closed/expired in the TX window. Carries the fresh lifecycle state out to the
 * catch site so `instanceof` yields a fully-typed `freshState` — no magic
 * property cast on a bare Error.
 */
class SessionClosedInTxError extends Error {
  constructor(
    readonly freshState: ReturnType<typeof toDtoLifecycleState> | null
  ) {
    super('__SESSION_CLOSED_IN_TX__');
  }
}

/**
 * Sentinel thrown inside the add-photo transaction when the in-transaction
 * pair read is missing. It maps to the same SESSION_CONTAINER_NOT_PAIRED
 * as the pre-flight guard. session-container-add-photo.operation.test.ts
 * (SC-2) returns a pair on the first read and null on the second, and
 * expects no insert. It does not run two transactions.
 */
class PairingRevokedInTxError extends Error {
  constructor(readonly stylistAccountId: string) {
    super('__PAIRING_REVOKED_IN_TX__');
  }
}

/**
 * Sentinel thrown inside the add-photo transaction when the photo owner
 * does not match the session's locked-in stylist. It maps to the same
 * SESSION_CONTAINER_PHOTO_OWNERSHIP as the pre-flight guard.
 * web-1/src/test-utils/integration/session-container-add-photo.test.ts
 * flips findUnique from an anonymous draft to a locked stylist on call 2
 * and expects 403. It does not run two transactions.
 */
class PhotoOwnershipMismatchInTxError extends Error {
  constructor(readonly lockedStylistAccountId: string) {
    super('__PHOTO_OWNERSHIP_MISMATCH_IN_TX__');
  }
}

export const addPhotoToSessionContainer_IO = async ({
  client_user_id,
  client_account_id,
  session_id,
  gallery_record_id,
}: {
  client_user_id: string;
  client_account_id: string;
  session_id: string;
  gallery_record_id: string;
}): Promise<
  OperationResult<
    SessionContainerDetailDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | SessionContainerInvalidStateError
    | SessionContainerNotPairedError
    | SessionContainerPhotoOwnershipError
    | SessionContainerPairSessionExistsError
    | DatabaseError
  >
> => {
  let session;
  let record;
  try {
    [session, record] = await Promise.all([
      DB_CLIENT.use.sessionContainer.findUnique({ where: { id: session_id } }),
      DB_CLIENT.use.galleryRecord.findUnique({
        where: { gallery_record_id },
        select: {
          gallery_record_id: true,
          created_by_account_id: true,
          is_hidden: true,
        },
      }),
    ]);
  } catch (error) {
    return databaseFailure('addPhotoToSessionContainer:fetch', error);
  }

  if (!session) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_FOUND',
      sessionId: session_id,
    });
  }

  if (session.client_account_id !== client_account_id) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: client_user_id,
    });
  }

  // DECISION: a TTL guard next to isClosedOrExpired: expires_at<=now while the lifecycle is still SHARED/ACTIVE (not
  // yet swept, sweep throttle ~6h) means the session is effectively terminal. isPastTtl mirrors the read side and
  // create/share. Without it a client keeps adding photos to an expired session for up to ~6h.
  const currentState = toDtoLifecycleState(session.lifecycle_state);
  if (isClosedOrExpired(currentState) || isPastTtl(session.expires_at)) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: session_id,
      currentState: currentState,
      attemptedAction: 'ADD_PHOTO',
    });
  }

  // DECISION: a moderation-hidden record (is_hidden) is rejected EXACTLY like a nonexistent one, same as the
  // favorite path (favorite-records.operations.ts: is_hidden kills add whatever the channel). Otherwise content removed
  // by moderation re-enters a session by reference (asset_url visible to the client + Visual CRM). The PHOTO_OWNERSHIP
  // mask (like not-found) is anti-enumeration; the read side loadSessionDetail already masks a photo added and hidden
  // later (hide-after-add backstop). The pre-flight layer suffices for the write: moderation hide is admin-driven (not
  // a hot concurrent path), so an in-TX re-check is unnecessary.
  if (!record || record.is_hidden) {
    return failure({
      type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP',
      sessionId: session_id,
      galleryRecordId: gallery_record_id,
      expectedStylistAccountId: session.stylist_account_id ?? '',
    });
  }

  // If session has stylist context, enforce: photo MUST belong to that stylist
  // and client MUST be paired.
  // SC-1: the pairing check issues raw Prisma reads (findActivePairing). Wrap
  // the whole pre-flight pairing block in try-catch so a DB error surfaces as a
  // DatabaseError OperationResult instead of an uncaught 500. (This is the
  // fast-fail layer; the authoritative re-check runs inside the TX below.)
  try {
    if (session.stylist_account_id) {
      if (
        record.created_by_account_id !== session.stylist_account_id &&
        !(await canUseSalonPhotoInSession_IO(
          client_user_id,
          session.stylist_account_id,
          record.created_by_account_id
        ))
      ) {
        return failure({
          type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP',
          sessionId: session_id,
          galleryRecordId: gallery_record_id,
          expectedStylistAccountId: session.stylist_account_id,
        });
      }

      const pair = await findActivePairing(
        client_user_id,
        session.stylist_account_id
      );
      if (!pair) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId: session.stylist_account_id,
        });
      }
    } else {
      // Anonymous draft — first photo determines stylist; client must be paired with that stylist
      const pair = await findActivePairing(
        client_user_id,
        record.created_by_account_id
      );
      if (!pair) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId: record.created_by_account_id,
        });
      }
    }
  } catch (error) {
    return databaseFailure('addPhotoToSessionContainer:pairingCheck', error);
  }

  // DECISION: position is max(position)+1 after lockSessionContainerRow.
  // See session-container-concurrency.helper.ts. The retry loop still runs
  // for P2002, 40P01 and 40001 when those errors appear. MAX_RETRIES is 12.
  const MAX_RETRIES = 12;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
    // Jittered backoff before retrying a CONFLICTED attempt (attempt 0 = no wait).
    // Decorrelated small jitter avoids thundering-herd lock-step re-contention.
    if (attempt > 0) {
      const backoffMs = Math.floor(Math.random() * (15 * attempt) + 5);
      await new Promise<void>(resolve => setTimeout(resolve, backoffMs));
    }
    try {
      await DB_CLIENT.use.$transaction(async tx => {
        // DECISION: FIRST in the TX, lockSessionContainerRow, before any read
        // or write, so max(position) is read after that lock. A null row means
        // the session vanished between pre-flight and now and surfaces as
        // invalid state.
        const activity = await lockSessionActivityContext(tx, session_id, {
          fallbackStylistId: record.created_by_account_id,
        });
        const locked = activity?.session;
        if (!locked) {
          throw new SessionClosedInTxError(null);
        }

        // DECISION: lifecycle_state is re-fetched INSIDE the TX before any write. The pre-TX `currentState` may be stale: a
        // concurrent SHARE/CLOSE can move the session to CLOSED/EXPIRED between the pre-TX fetch and this TX start (READ
        // COMMITTED does not protect that window). Stale state throws to roll back and surfaces
        // SESSION_CONTAINER_INVALID_STATE.
        const freshSession = await tx.sessionContainer.findUnique({
          where: { id: session_id },
          select: {
            lifecycle_state: true,
            stylist_account_id: true,
            expires_at: true,
          },
        });
        if (!freshSession) {
          throw new SessionClosedInTxError(null);
        }
        const freshState = toDtoLifecycleState(freshSession.lifecycle_state);
        // isPastTtl beside isClosedOrExpired: the TTL can pass between pre-flight and
        // this transaction, the same window as the state, pairing and ownership re-checks.
        // Test: session-container-add-photo.operation.test.ts (past TTL inside the
        // transaction writes nothing; not a live race).
        if (
          isClosedOrExpired(freshState) ||
          isPastTtl(freshSession.expires_at)
        ) {
          throw new SessionClosedInTxError(freshState);
        }

        // DECISION: the pairing is re-validated INSIDE the TX with the tx client, sharing the snapshot of the write below. The
        // pre-flight pairing check can go stale: a concurrent pairingRevoke_IO between pre-flight and this TX would otherwise
        // let a photo land on a session whose pairing is no longer ACTIVE. The effective stylist is the session's locked
        // stylist when present, else the anonymous-draft lock-in target (record.created_by_account_id: the first photo
        // decides). A sentinel maps to the SAME SESSION_CONTAINER_NOT_PAIRED failure as the pre-flight (no new kernel error).
        const effectiveStylistAccountId =
          freshSession.stylist_account_id ?? record.created_by_account_id;
        const activePair = await findActivePairing(
          client_user_id,
          effectiveStylistAccountId,
          tx
        );
        if (!activePair) {
          throw new PairingRevokedInTxError(effectiveStylistAccountId);
        }

        // DECISION: photo OWNERSHIP is re-validated inside the TX when the session already has a locked stylist. The
        // pre-flight ownership guard (the `if (session.stylist_account_id)` block above) does not run for an anonymous draft
        // (else branch). Under concurrency two add-photos on the SAME anonymous draft both see stylist_account_id === null:
        // req-A locks in stylist X (first photo), req-B's photo belongs to Y, and its in-TX pairing check passes (the client
        // is paired with X == effectiveStylistAccountId) but Y != X. Without this guard Y's photo lands in a session locked to
        // X, breaking the invariant "all photos belong to the session's stylist". It matters ONLY when the stylist is already
        // locked (freshSession.stylist_account_id non-null); for a still-anonymous draft the photo DEFINES the stylist (lock-in
        // below), so no mismatch exists. Sentinel as above -> PHOTO_OWNERSHIP.
        if (
          freshSession.stylist_account_id !== null &&
          !(await canUseSalonPhotoInSession_IO(
            client_user_id,
            freshSession.stylist_account_id,
            record.created_by_account_id,
            tx
          ))
        ) {
          throw new PhotoOwnershipMismatchInTxError(
            freshSession.stylist_account_id
          );
        }

        // DECISION: the first photo of a stylist-less session decides its stylist (lock-in below), and the pair may hold only
        // ONE open session (partial-unique `session_container_active_pair_uq`; a DRAFT counts). Checked here, under the row
        // lock and before any write, so the refusal names the session that is already open; the index stays the race backstop
        // (P2002 'active_pair' in the catch maps to the same error).
        if (freshSession.stylist_account_id === null) {
          await assertNoOtherOpenPairSession(tx, {
            client_account_id,
            stylist_account_id: record.created_by_account_id,
            session_id,
          });
        }

        // Determine next position (append to end) — atomic within TX
        const lastPosition = await tx.sessionContainerPhoto.findFirst({
          where: { session_id },
          orderBy: { position: 'desc' },
          select: { position: true },
        });
        const nextPosition = (lastPosition?.position ?? -1) + 1;

        // Idempotent insert: rely on unique [session_id, gallery_record_id]
        const existingPhoto = await tx.sessionContainerPhoto.findUnique({
          where: {
            session_id_gallery_record_id: { session_id, gallery_record_id },
          },
        });

        if (!existingPhoto) {
          await tx.sessionContainerPhoto.create({
            data: {
              session_id,
              gallery_record_id,
              position: nextPosition,
            },
          });
        }

        if (!existingPhoto && activity?.activePairId) {
          await writeSessionActivity(tx, {
            sessionId: session_id,
            pairId: activity.activePairId,
            kind: 'SESSION_CHANGED',
            changeScope: 'PHOTOS',
            activityAt: activity.activityAt,
          });
        }

        // Promote DRAFT → READY when first photo arrives, and lock-in stylist if anonymous
        const stateUpdate: {
          lifecycle_state?: (typeof SessionContainerLifecycleStateValue)[keyof typeof SessionContainerLifecycleStateValue];
          stylist_account_id?: string;
        } = {};

        if (freshState === SessionContainerLifecycleStateValue.DRAFT) {
          stateUpdate.lifecycle_state =
            SessionContainerLifecycleStateValue.READY;
        }
        if (!freshSession.stylist_account_id) {
          stateUpdate.stylist_account_id = record.created_by_account_id;
        }

        if (Object.keys(stateUpdate).length > 0) {
          await tx.sessionContainer.update({
            where: { id: session_id },
            data: stateUpdate,
          });
        }
      });

      return await loadSessionDetail_IO(session_id);
    } catch (error) {
      lastError = error;
      // Session was closed/expired inside the TX window — surface proper error, no retry
      if (error instanceof SessionClosedInTxError) {
        return failure({
          type: 'SESSION_CONTAINER_INVALID_STATE',
          sessionId: session_id,
          currentState: error.freshState ?? currentState,
          attemptedAction: 'ADD_PHOTO',
        });
      }
      // SC-2: pairing was revoked inside the TX window — surface NOT_PAIRED, no
      // retry (a revoked pairing does not recover on retry).
      if (error instanceof PairingRevokedInTxError) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId: error.stylistAccountId,
        });
      }
      // SC-3: the photo's owner did not match the session's locked-in stylist
      // (concurrent anonymous-draft lock-in) — surface PHOTO_OWNERSHIP, no retry
      // (a mismatched owner does not become correct on retry).
      if (error instanceof PairSessionExistsInTxError) {
        return failure({
          type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS',
          sessionId: session_id,
          stylistAccountId: error.stylistAccountId,
          existingSessionId: error.existingSessionId,
        });
      }
      if (error instanceof PhotoOwnershipMismatchInTxError) {
        return failure({
          type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP',
          sessionId: session_id,
          galleryRecordId: gallery_record_id,
          expectedStylistAccountId: error.lockedStylistAccountId,
        });
      }
      // DECISION: classify P2002 via the adapter-pg raw cause (classifyUniqueConstraintViolation, session-container-
      // concurrency.helper.ts), NOT error.meta.target, and detect P2002 STRUCTURALLY (isP2002), NOT via instanceof. THREE
      // unique constraints are reachable from this path and each maps to a DIFFERENT outcome, so there is NO catch-all
      // "other -> 429" (it mis-mapped a duplicate-photo P2002 to a bogus 429):
      //   - 'position'        (session_id, position): a concurrent insert won the position race -> retry;
      //   - 'duplicate_photo' (session_id, gallery_record_id): the same record was added twice -> IDEMPOTENT SUCCESS (return
      //     the current container detail, like the in-TX findUnique path); re-adding is a no-op, not a quota breach.
      //     The classification must stay correct when that constraint fires;
      //   - 'active_pair'     (partial-unique session_container_active_pair_uq): locking in the stylist on an anonymous
      //     draft collided with an existing live (client, stylist) session -> per-client cap (429), not a 500;
      //   - 'other'|'unknown' -> falls through to databaseFailure: an unrecognized constraint must NOT fabricate a 429.
      // Why not the old checks: under @prisma/adapter-pg `error.meta.target` is UNDEFINED for these indexes (active_pair is a
      // raw-SQL partial index Prisma does not know), so `target.includes(...)` was dead and active_pair fell to an unmapped
      // 500; and `instanceof Prisma.PrismaClientKnownRequestError` is FALSE in the bundled (Turbopack) runtime (duplicated
      // class identity, same reason serialization-conflict.ts avoids it), which skipped the whole block.
      if (isP2002(error)) {
        const violated = classifyUniqueConstraintViolation(error);
        // Only retry on the position constraint — a concurrent insert won the
        // max(position)+1 race.
        if (violated === 'position') {
          continue;
        }
        // Duplicate gallery_record_id in this container → the photo is already
        // present. Return the current container detail idempotently (mirrors the
        // in-TX findUnique short-circuit), NOT a 429 quota error.
        if (violated === 'duplicate_photo') {
          return await loadSessionDetail_IO(session_id);
        }
        // Stylist lock-in on an anonymous draft collided with an existing live
        // (client, stylist) session that a concurrent request created after the
        // in-TX check above → the same pair conflict (409), NOT the per-client
        // cap: she is not at any limit, she already has a session with her.
        if (violated === 'active_pair') {
          return failure({
            type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS',
            sessionId: session_id,
            stylistAccountId: record.created_by_account_id,
            existingSessionId: await findOtherOpenPairSessionId({
              client_account_id,
              stylist_account_id: record.created_by_account_id,
              session_id,
            }),
          });
        }
        // violated === 'other' | 'unknown' → fall through to databaseFailure
        // below (do NOT silently 429 an unrecognized constraint).
      }
      // DECISION: a 40P01 or 40001 is retried like a P2002 position conflict,
      // with backoff, instead of databaseFailure on the first throw. The helper
      // test marks those shapes retryable. It does not show they cannot occur.
      if (isConcurrencyConflict(error)) {
        continue;
      }
      return databaseFailure('addPhotoToSessionContainer:transaction', error);
    }
  }

  return databaseFailure(
    'addPhotoToSessionContainer:transaction:max-retries-exceeded',
    lastError
  );
};
