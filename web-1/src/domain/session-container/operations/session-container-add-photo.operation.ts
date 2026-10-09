/**
 * SessionContainer ADD-PHOTO operation (R8)
 *
 * Split from session-container-commands.operations.ts to stay under ESLint
 * max-lines (350). Mirrors the 1:1 split pattern of session-container-share.operation.ts.
 * Behaviour is identical to the pre-split commands file — idempotent insert,
 * CAS position retry, in-TX lifecycle re-check, stylist lock-in.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { failure } from '@kernel/application/result.types';
import type {
  SessionContainerMaxActiveExceededError,
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
  lockSessionContainerRow,
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
 * Sentinel thrown inside the add-photo $transaction when the client/stylist
 * pairing is no longer ACTIVE at write time. Carries the effective stylist
 * account id out to the catch site so it maps to the SAME
 * SESSION_CONTAINER_NOT_PAIRED failure the pre-flight check returns — closes
 * the pairing TOCTOU window (SC-2) without a new kernel error type.
 */
class PairingRevokedInTxError extends Error {
  constructor(readonly stylistAccountId: string) {
    super('__PAIRING_REVOKED_IN_TX__');
  }
}

/**
 * Sentinel thrown inside the add-photo $transaction when the photo's owning
 * stylist no longer matches the session's locked-in stylist. Closes the
 * OWNERSHIP TOCTOU (SC-3): the pre-flight ownership guard only runs for a session
 * that already had a stylist; an anonymous DRAFT skips it. Carries the locked-in
 * stylist out to the catch site so it maps to the SAME
 * SESSION_CONTAINER_PHOTO_OWNERSHIP the pre-flight guard returns sequentially.
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
    | SessionContainerMaxActiveExceededError
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

  // DECISION (nie usuwaj tego komentarza): guard TTL obok isClosedOrExpired (finding
  // sc-addphoto-1) — expires_at<=now przy lifecycle nadal SHARED/ACTIVE (niezamiecione,
  // sweep throttle ~6h) = sesja efektywnie terminalna. isPastTtl lustruje read-side i
  // create/share (SC-4). Bez tego klientka dopisuje zdjęcia do wygasłej sesji do ~6h.
  const currentState = toDtoLifecycleState(session.lifecycle_state);
  if (isClosedOrExpired(currentState) || isPastTtl(session.expires_at)) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: session_id,
      currentState: currentState,
      attemptedAction: 'ADD_PHOTO',
    });
  }

  // DECISION (nie usuwaj tego komentarza): odrzuć rekord moderation-hidden (is_hidden)
  // NA RÓWNI z nieistniejącym (finding sc-addphoto-2) — parytet z favorite/like path
  // (favorite-records.operations.ts: `if (accessRecord.is_hidden || ...) return ok:false`,
  // "is_hidden ubija add niezależnie od kanału"). Bez tego content zdjęty moderacją wraca
  // referencyjnie do sesji (asset_url widoczny klientce + Visual CRM). Maska PHOTO_OWNERSHIP
  // (jak not-found) = anti-enumeration; read-side loadSessionDetail maskuje już-dodane-potem-
  // ukryte dla klientki (backstop na hide-after-add). Warstwa pre-flight wystarcza na write:
  // moderation-hide jest admin-driven (nie hot concurrent path), więc in-TX re-check zbędny.
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
      if (record.created_by_account_id !== session.stylist_account_id) {
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

  // DECISION (nie usuwaj tego komentarza):
  // Position uniqueness under concurrency (DD2-D2 run 24 → finding session-container-1).
  // SessionContainerPhoto has @@unique([session_id, position]). max(position)+1 read inside a
  // TX under READ COMMITTED does NOT block competing inserts, so two concurrent transactions
  // used to pick the SAME nextPosition. The PRIMARY guard is now a pessimistic row-lock on the
  // owning SessionContainer row (lockSessionContainerRow, FIRST statement in the TX below):
  // it serializes all concurrent photo-inserts for ONE session, so each insert reads the
  // COMMITTED max(position) and the collision is eliminated deterministically — NOT papered
  // over by P2002-retry. The retry loop is now a belt-and-suspenders safety net for transient
  // conflicts (P2002-position should no longer fire; deadlock 40P01 / serialization 40001 are
  // unreachable from the single lock order but retried if ever seen). MAX_RETRIES raised to 12
  // with a small jittered backoff between attempts so a brief lock-wait queue never exhausts
  // retries → 500 + silent photo-loss (the bug). Contention on a single session is rare
  // (user-initiated multi-photo action, not a hot path), so the lock-serialized throughput is
  // a non-issue.
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
        // DECISION (nie usuwaj tego komentarza):
        // FIRST in the TX — pessimistic row-lock on the owning SessionContainer so concurrent
        // add-photo inserts for THIS session serialize here (kills the position-collision race
        // + retry-exhaustion 500 + silent photo-loss, finding session-container-1). Lock before
        // ANY read/write below so max(position) is always read against committed state. A null
        // row means the session vanished (cascade) between pre-flight and now → surface the same
        // not-found-shaped invalid-state via the sentinel (no separate kernel error).
        const locked = await lockSessionContainerRow(tx, session_id);
        if (!locked) {
          throw new SessionClosedInTxError(null);
        }

        // DECISION (nie usuwaj tego komentarza):
        // Re-fetch lifecycle_state INSIDE the TX before any writes. The pre-TX
        // `currentState` (computed at L182) may be stale — a concurrent SHARE/CLOSE
        // could have transitioned the session to CLOSED/EXPIRED between the pre-TX
        // fetch and this TX start (READ COMMITTED does not protect against that window).
        // Throw on stale state to trigger rollback and surface SESSION_CONTAINER_INVALID_STATE.
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
        // isPastTtl obok isClosedOrExpired (finding sc-addphoto-1): domyka TOCTOU gdy
        // TTL mija między pre-flight a TX (jak SC-2/SC-3 dla stanu/pairingu/ownershipu).
        if (
          isClosedOrExpired(freshState) ||
          isPastTtl(freshSession.expires_at)
        ) {
          throw new SessionClosedInTxError(freshState);
        }

        // DECISION (nie usuwaj tego komentarza):
        // SC-2 — re-validate the pairing INSIDE the TX using the tx-client, so
        // it shares the same READ COMMITTED snapshot as the write below. The
        // pre-TX pairing check (pre-flight) can go stale: a concurrent
        // pairingRevoke_IO between the pre-flight read and this TX start would
        // otherwise let a photo land on a session whose pairing is no longer
        // ACTIVE (invalid state). The effective stylist is the session's locked
        // stylist when present, else the anonymous-draft lock-in target
        // (record.created_by_account_id — first photo decides). Throw a sentinel
        // that maps to the SAME SESSION_CONTAINER_NOT_PAIRED failure the
        // pre-flight returns (no new kernel error).
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

        // DECISION (nie usuwaj tego komentarza): SC-3 — re-waliduj OWNERSHIP zdjęcia
        // wewnątrz TX, gdy sesja ma JUŻ zablokowaną stylistkę. Pre-flight ownership
        // guard (blok `if (session.stylist_account_id)` wyżej) NIE uruchamia się dla
        // anonimowego draftu (gałąź else). Pod współbieżnością dwa add-photo na TYM
        // SAMYM anonimowym drafcie widzą stylist_account_id === null w pre-flight:
        // req-A locks-in stylistkę X (pierwsze zdjęcie), zdjęcie req-B należy do Y —
        // jego in-TX pairing check przechodzi (klientka sparowana z X ==
        // effectiveStylistAccountId), ale Y ≠ X. Bez tego guardu zdjęcie Y ląduje w
        // sesji zablokowanej na X, łamiąc inwariant „wszystkie zdjęcia należą do
        // stylistki sesji" (ścieżka sekwencyjna zabrania tego w pre-flight ownership).
        // Sensowne TYLKO gdy stylistka JUŻ zablokowana (freshSession.stylist_account_id
        // non-null); dla wciąż-anonimowego draftu to zdjęcie DEFINIUJE stylistkę (lock-in
        // niżej), więc mismatch nie istnieje. Sentinel jak SC-2 → PHOTO_OWNERSHIP.
        if (
          freshSession.stylist_account_id !== null &&
          record.created_by_account_id !== freshSession.stylist_account_id
        ) {
          throw new PhotoOwnershipMismatchInTxError(
            freshSession.stylist_account_id
          );
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
      if (error instanceof PhotoOwnershipMismatchInTxError) {
        return failure({
          type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP',
          sessionId: session_id,
          galleryRecordId: gallery_record_id,
          expectedStylistAccountId: error.lockedStylistAccountId,
        });
      }
      // DECISION (nie usuwaj tego komentarza) — classify via the adapter-pg raw cause,
      // NOT error.meta.target, and detect P2002 STRUCTURALLY, NOT via instanceof
      // (finding session-container-3; per-constraint routing rozszerzone po cross-model
      // review GPT-5.5 r1b). P2002 = a unique-constraint violation; THREE unique constraints
      // exist on SessionContainerPhoto/SessionContainer reachable from this path — each maps
      // to a DIFFERENT outcome, so the classifier distinguishes ALL THREE explicitly (NO
      // catch-all "other → 429", which previously mis-mapped a duplicate-photo P2002 to a
      // bogus 429 max-active):
      //   • (session_id, position)            → a concurrent insert won the position race; retry,
      //   • (session_id, gallery_record_id)   → the SAME gallery record was added to THIS
      //     container twice → IDEMPOTENT SUCCESS (the photo is already in; return the current
      //     container detail — mirrors the in-TX findUnique idempotent path above). NOT a 429:
      //     re-adding a duplicate is a no-op, not a quota breach. Under the row-lock this is
      //     practically unreachable (the in-TX findUnique short-circuits the insert), but the
      //     classification MUST be correct (defence-in-depth + correctness).
      //   • session_container_active_pair_uq (partial-unique) → locking-in the stylist on an
      //     anonymous draft (first photo) collided with an existing live (client, stylist)
      //     session → surface the per-client cap (429), NOT a 500 — the client already has a
      //     live session with this stylist.
      // TWO root-cause gaps (finding session-container-3), both verified by probe on the live
      // DB + in-app diagnostic:
      //   1. Under @prisma/adapter-pg `error.meta.target` is UNDEFINED for these indexes
      //      (active_pair is a raw-SQL partial index Prisma doesn't know; the schema indexes
      //      also return no target). The old `target.includes(...)` checks were dead →
      //      active_pair fell through to an unmapped 500, and position-retry never fired
      //      (masked only because the row-lock makes the position collision unreachable).
      //   2. `error instanceof Prisma.PrismaClientKnownRequestError` returns FALSE in the
      //      bundled (Turbopack) runtime even though error.constructor.name IS
      //      'PrismaClientKnownRequestError' — duplicate class identities across module
      //      realizations break instanceof (same reason serialization-conflict.ts avoids it).
      //      So even after fixing the constraint detection, the instanceof guard skipped the
      //      whole P2002 block → still a 500. Detect structurally via isP2002 (error.code).
      // The classifier reads error.meta.driverAdapterError.cause (index name + constraint
      // fields) and is null-safe for any input. Routing:
      //   • 'position'        → retry,
      //   • 'duplicate_photo' → idempotent success (loadSessionDetail_IO — photo already in),
      //   • 'active_pair'     → per-client cap (429),
      //   • 'other'|'unknown' → fall through to databaseFailure: an UNRECOGNIZED constraint
      //     (or one not extractable) must NOT fabricate a 429 — surface as a mapped DB error.
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
        // (client, stylist) session → the client already has a live session with
        // this stylist → per-client cap (429).
        if (violated === 'active_pair') {
          return failure({
            type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
            clientAccountId: client_account_id,
            currentCount:
              SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT,
            limit: SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT,
          });
        }
        // violated === 'other' | 'unknown' → fall through to databaseFailure
        // below (do NOT silently 429 an unrecognized constraint).
      }
      // DECISION (nie usuwaj tego komentarza):
      // Belt-and-suspenders (finding session-container-1): a transient transaction-abort
      // (deadlock 40P01 or serialization 40001) is RETRY-able exactly like P2002-position —
      // retry with backoff instead of letting it fall through to an unmapped 500. The row-lock
      // above makes both effectively unreachable from this path (single lock order, READ
      // COMMITTED never raises 40001), so this branch should never fire in practice; it exists
      // so no unforeseen path turns a recoverable conflict into a dropped photo.
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
