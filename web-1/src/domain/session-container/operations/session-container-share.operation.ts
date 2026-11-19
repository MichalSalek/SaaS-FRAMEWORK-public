import {
  findActivePairing,
  countSessionsTowardSharedLimit_IO,
  isSalonReachedStylist_IO,
} from './session-container-shared.operations';
import { isSharedSessionLimitReached } from '@kernel/domain/session-container/session-container.limit';
import {
  lockSessionActivityContext,
  lockSessionActivityUsers,
} from '../session-activity.lock';
import { writeSessionActivity } from '../session-activity.write';
/**
 * SessionContainer SHARE operation (R8)
 *
 * Split from lifecycle file to stay under ESLint max-lines (350).
 * Quota race prevention uses count-then-update + POST-UPDATE VERIFY pattern.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { TIME } from '@kernel/application/constants.config';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  SessionContainerEmptyError,
  SessionContainerInvalidStateError,
  SessionContainerMaxActiveExceededError,
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
  SessionContainerNotPairedError,
  SessionContainerShareQuotaExceededError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  mapSessionToDTO,
  toDtoLifecycleState,
  isShareableState,
  calculateExpiresAt,
} from './session-container-shared.operations';

// DECISION: the share throttle is PER PAIR (this client -> this stylist), a platform constant independent of the stylist's
// plan. It used to be the stylist's inbox limit from her plan (Free 5, Pro 20) counted by
// `stylist_account_id` alone, with two flaws: (1) one client could lock out a stylist: she closes the session herself
// (`closeSessionContainer_IO` accepts the owner) and `shared_at` stays, so a loop "share, close, create a new one" ate the
// stylist's whole hourly budget (smoke C4 did exactly that with one client); (2) EVERY other client of that stylist was then
// refused, with a message blaming the stylist. Now only the sender is limited: whoever sent the same stylist
// SESSION_SHARES_PER_PAIR_PER_HOUR sessions in the last hour waits. An honest client has one live session at a time with a
// stylist, so three shares an hour is already two corrections. There is structurally no race: the index
// `session_container_active_pair_uq` allows one non-terminal session per pair, so two parallel shares of one pair are the
// same session, which the atomic CAS below settles. Hence the `lockStylistAccount` lock (it serialized all shares to a stylist
// only for the old counter) and the post-write recount are gone. The per-plan limit field and its usage counter were removed
// (owner). `can_use_session_share` is true on every plan; if a plan ever disables it, the gate returns
// here with its own error. (owner)
export const SESSION_SHARES_PER_PAIR_PER_HOUR = 3;

/**
 * Sentinel thrown inside the share $transaction when the session is no longer in
 * a shareable state (DRAFT/READY) at TX time. Carries the fresh lifecycle state
 * out to the catch site so `instanceof` yields a fully-typed `freshState` — no
 * magic-string cast. Mirrors SessionClosedInTxError in the commands operations.
 */
class SessionNotShareableInTxError extends Error {
  constructor(
    readonly freshState: ReturnType<typeof toDtoLifecycleState> | null
  ) {
    super('__SESSION_NOT_SHAREABLE_IN_TX__');
  }
}

export const shareSessionContainer_IO = async ({
  client_user_id,
  client_account_id,
  session_id,
}: {
  client_user_id: string;
  client_account_id: string;
  session_id: string;
}): Promise<
  OperationResult<
    SessionContainerDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | SessionContainerInvalidStateError
    | SessionContainerEmptyError
    | SessionContainerNotPairedError
    | SessionContainerMaxActiveExceededError
    | SessionContainerShareQuotaExceededError
    | DatabaseError
  >
> => {
  let session;
  try {
    session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
    });
  } catch (error) {
    return databaseFailure('shareSessionContainer', error);
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

  const currentState = toDtoLifecycleState(session.lifecycle_state);
  if (!isShareableState(currentState)) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: session_id,
      currentState,
      attemptedAction: 'SHARE',
    });
  }

  if (!session.stylist_account_id) {
    return failure({ type: 'SESSION_CONTAINER_EMPTY', sessionId: session_id });
  }

  const stylistAccountId = session.stylist_account_id;

  // SCCAP-K1: wrap the authorization read so a DB failure yields a controlled
  // DATABASE_ERROR (mirrors the findUnique guard above), not an uncaught throw.
  let pair;
  try {
    pair = await findActivePairing(client_user_id, stylistAccountId);
  } catch (error) {
    return databaseFailure('shareSessionContainer', error);
  }
  if (!pair) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_PAIRED',
      clientUserId: client_user_id,
      stylistAccountId,
    });
  }

  try {
    // DECISION: the SHARE quota uses count-then-update + POST-UPDATE VERIFY. Throwing inside the TX is the standard Prisma
    // rollback, so no SERIALIZABLE is needed. Race-safety boundary: under READ COMMITTED the POST-UPDATE VERIFY alone is NOT
    // race-safe across several DIFFERENT parallel sessions of one client, since each TX sees only its own +1. The per-CLIENT
    // active-slot cap has a STRUCTURAL backstop: the partial-unique index on the (client, stylist) pair == 1 active session,
    // times PLATFORM_LIMITS.MAX_PAIRED_STYLISTS (3) == SESSION_MAX_ACTIVE_PER_CLIENT (3), a hard ceiling on the session count.
    // POST-UPDATE VERIFY protects only against self-double-share of the same session (atomic CAS updateMany below) and gives a
    // fast-fail. The hourly throttle (per pair) needs no lock or recount: see the DECISION at SESSION_SHARES_PER_PAIR_PER_HOUR.
    const sharedLimit = SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT;
    return await DB_CLIENT.use.$transaction(async tx => {
      // Salon-derived contacts exceed the direct pairing cap, so serialize the
      // per-client session quota explicitly instead of relying on pair count.
      await lockSessionActivityUsers(tx, client_user_id, stylistAccountId);
      // SC-4 (expired-but-unswept sessions take no slot) lives in
      // countSessionsTowardSharedLimit_IO. The hourly brake below counts by
      // `shared_at` window, a separate axis (how often she sends, not how many).

      // SC-6 fast-fail re-fetch (optimization, NOT the safety mechanism — that is
      // the atomic conditional updateMany below). The pre-TX
      // `isShareableState(currentState)` check (L~85) runs on a stale findUnique;
      // re-reading here short-circuits the common already-SHARED/CLOSED case before
      // we spend quota counts + the stylistAccount lookup, and yields the precise
      // freshState for the error payload. The true concurrent-race backstop is the
      // CAS update. Mirrors the addPhoto re-fetch pattern (commands operations).
      const freshSession = await tx.sessionContainer.findUnique({
        where: { id: session_id },
        select: { lifecycle_state: true },
      });
      if (!freshSession) {
        throw new SessionNotShareableInTxError(null);
      }
      const freshState = toDtoLifecycleState(freshSession.lifecycle_state);
      if (!isShareableState(freshState)) {
        throw new SessionNotShareableInTxError(freshState);
      }

      const photoCount = await tx.sessionContainerPhoto.count({
        where: { session_id },
      });
      if (photoCount === 0) {
        return failure({
          type: 'SESSION_CONTAINER_EMPTY',
          sessionId: session_id,
        });
      }

      // SC-1: per-CLIENT active-slot cap (DOMAIN_SSOT §3.2) — count THIS CLIENT's live
      // sessions across her stylists, NOT the stylist's inbox. A stylist reached
      // through a salon is outside the limit (kernel session-container.limit.ts).
      const outsideLimit = await isSalonReachedStylist_IO(
        tx,
        client_user_id,
        stylistAccountId
      );
      if (!outsideLimit) {
        const activeCount = await countSessionsTowardSharedLimit_IO(
          tx,
          client_user_id,
          client_account_id
        );
        if (isSharedSessionLimitReached(activeCount)) {
          return failure({
            type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
            clientAccountId: client_account_id,
            currentCount: activeCount,
            limit: sharedLimit,
          });
        }
      }

      const oneHourAgo = new Date(Date.now() - TIME.MS_PER_HOUR);
      const recentPairShareCount = await tx.sessionContainer.count({
        where: {
          client_account_id,
          stylist_account_id: stylistAccountId,
          shared_at: { gte: oneHourAgo },
        },
      });
      if (recentPairShareCount >= SESSION_SHARES_PER_PAIR_PER_HOUR) {
        return failure({
          type: 'SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED',
          stylistAccountId,
          currentCount: recentPairShareCount,
          limit: SESSION_SHARES_PER_PAIR_PER_HOUR,
        });
      }

      const activity = await lockSessionActivityContext(tx, session_id, {
        ensureSalonPair: true,
      });
      if (!activity?.activePairId) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId,
        });
      }

      const sharedAt = new Date();
      const expiresAt = calculateExpiresAt(sharedAt);

      // DECISION: atomic compare-and-swap: a conditional updateMany WHERE lifecycle_state IN (DRAFT,READY). The in-TX re-fetch
      // above narrows the TOCTOU window, but a bare update-by-id under READ COMMITTED still lets two concurrent SHAREs both write
      // SHARED (no row lock on SELECT). Folding the state predicate into the UPDATE makes the transition one atomic statement:
      // only ONE writer matches rows; the loser gets count=0 -> rollback -> INVALID_STATE. Same idiom as the recovery-window
      // atomic updateMany (DOMAIN_SSOT §13.1).
      const transition = await tx.sessionContainer.updateMany({
        where: {
          id: session_id,
          lifecycle_state: {
            in: [
              SessionContainerLifecycleStateValue.DRAFT,
              SessionContainerLifecycleStateValue.READY,
            ],
          },
        },
        data: {
          lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
          shared_at: sharedAt,
          expires_at: expiresAt,
        },
      });
      if (transition.count === 0) {
        // A concurrent SHARE already transitioned this session — surface stale state.
        throw new SessionNotShareableInTxError(null);
      }

      const updated = await tx.sessionContainer.findUniqueOrThrow({
        where: { id: session_id },
      });

      // POST-UPDATE VERIFY: re-count active sessions after marking SHARED. This session is now SHARED with a future expires_at, so
      // it correctly counts itself as one occupied slot (the notExpired filter excludes only stale ones). It is NOT a per-client
      // race backstop: under READ COMMITTED each parallel TX sees only its own +1, so two different sessions of one client pass
      // VERIFY independently. The structural ceiling is the partial-unique pair index x MAX_PAIRED_STYLISTS ==
      // SESSION_MAX_ACTIVE_PER_CLIENT (see the DECISION at the start of the TX). This re-count only catches state visible to the
      // TX itself (e.g. the expiry sweep): defence-in-depth.
      const finalActiveCount = await countSessionsTowardSharedLimit_IO(
        tx,
        client_user_id,
        client_account_id
      );
      if (finalActiveCount > sharedLimit) {
        throw new Error('__SHARE_ACTIVE_RACE__');
      }

      await writeSessionActivity(tx, {
        sessionId: session_id,
        pairId: activity.activePairId,
        kind: 'SESSION_SUBMITTED',
        activityAt: activity.activityAt,
      });
      return success(mapSessionToDTO(updated, photoCount));
    });
  } catch (error) {
    // SC-6: session transitioned out of DRAFT/READY inside the TX window
    // (concurrent SHARE/CLOSE/expire) — surface proper invalid-state error.
    if (error instanceof SessionNotShareableInTxError) {
      return failure({
        type: 'SESSION_CONTAINER_INVALID_STATE',
        sessionId: session_id,
        currentState: error.freshState ?? currentState,
        attemptedAction: 'SHARE',
      });
    }
    if (error instanceof Error) {
      if (error.message === '__SHARE_ACTIVE_RACE__') {
        return failure({
          type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
          clientAccountId: client_account_id,
          currentCount: SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT,
          limit: SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT,
        });
      }
    }
    return databaseFailure('shareSessionContainer', error);
  }
};
