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
  findActivePairing,
  SHARED_STATES_FOR_PRISMA,
} from './session-container-shared.operations';

// DECISION (nie usuwaj tego komentarza) — owner 2026-10-09:
// Hamulec udostępnień liczy się PER PARA (ta klientka → ta stylistka), jest
// stałą platformy i NIE zależy od planu stylistki.
// Do tego dnia był to limit skrzynki stylistki z jej planu
// (`max_shares_per_hour`: Free 5, Pro 20), liczony po samym `stylist_account_id`.
// Dwie wady, obie zgłoszone przez ownera:
//  1. jedna klientka mogła zablokować stylistkę: sesję zamyka sama
//     (`closeSessionContainer_IO` przyjmuje właścicielkę), `shared_at` zostaje,
//     więc pętla „udostępnij, zamknij, utwórz nową” zjadała cały godzinny
//     budżet stylistki (smoke C4 robił dokładnie to jedną klientką);
//  2. odmowę dostawała potem KAŻDA inna klientka tej stylistki, czyli osoba,
//     która nic nie zrobiła, z komunikatem zrzucającym winę na stylistkę.
// Teraz ogranicza się wyłącznie nadawczynię: kto wysłał tej samej stylistce
// SESSION_SHARES_PER_PAIR_PER_HOUR sesji w ostatniej godzinie, czeka. Uczciwa
// klientka ma u stylistki jedną żywą sesję naraz, więc trzy wysyłki na godzinę
// to już dwie poprawki; nikt inny nie odczuwa cudzego zalewu.
// Wyścigu tu nie ma strukturalnie: indeks `session_container_active_pair_uq`
// dopuszcza jedną nieterminalną sesję na parę, więc dwie równoległe wysyłki tej
// samej pary to ta sama sesja, a tę rozstrzyga atomowy CAS niżej. Dlatego
// zniknęły blokada `lockStylistAccount` (serializowała wszystkie wysyłki do
// stylistki wyłącznie na potrzeby starego licznika) i powtórne liczenie po
// zapisie.
// `max_shares_per_hour` w PRICING_LIMITS_SSOT i kolumna PlanConfig zostają jako
// martwe pole do czasu migracji usuwającej (nieaddytywna, decyzja ownera): nie
// czytać go tutaj z powrotem i nie pokazywać w cenniku.
// `can_use_session_share` jest prawdą na każdym planie; gdy któryś plan je
// wyłączy, bramka wraca tutaj z własnym błędem.
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
    // DECISION (nie usuwaj tego komentarza):
    // SHARE quota uses count-then-update + POST-UPDATE VERIFY pattern. Throwing
    // inside TX is the standard Prisma rollback mechanism — no SERIALIZABLE needed.
    // UWAGA o granicach race-safety: pod READ COMMITTED POST-UPDATE VERIFY sam w sobie
    // NIE jest race-safe dla wielu ROZNYCH rownoleglych sesji tej samej klientki — kazda
    // TX widzi tylko WLASNE +1. Per-CLIENT active-slot cap ma backstop STRUKTURALNY:
    // partial-unique index na pare (client,stylist) == 1 aktywna sesja, razy
    // PLATFORM_LIMITS.MAX_PAIRED_STYLISTS (==3) == SESSION_MAX_ACTIVE_PER_CLIENT (==3)
    // → twardy strop liczby sesji. POST-UPDATE VERIFY chroni jedynie przed
    // SAMO-double-share tej samej sesji (atomic CAS updateMany nizej) i daje fast-fail.
    // Hamulec godzinowy (per para) nie potrzebuje blokady ani powtórnego liczenia:
    // DECISION przy SESSION_SHARES_PER_PAIR_PER_HOUR.
    const sharedLimit = SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT;
    return await DB_CLIENT.use.$transaction(async tx => {
      // SC-4: expired-but-unswept sessions (still SHARED/ACTIVE in DB) no longer
      // occupy a quota slot. Mirror the read-side expiry filter
      // (getMySessionContainers_IO) so the active-slot count doesn't over-report.
      // NOTE: the hourly brake below counts by `shared_at` window, NOT by this
      // filter — a separate axis (how often she sends, not how many are live).
      const now = new Date();
      const notExpiredFilter = {
        OR: [{ expires_at: null }, { expires_at: { gt: now } }],
      };

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
      // sessions across all her paired stylists, NOT the stylist's inbox.
      const activeCount = await tx.sessionContainer.count({
        where: {
          client_account_id,
          lifecycle_state: { in: [...SHARED_STATES_FOR_PRISMA] },
          ...notExpiredFilter,
        },
      });
      if (activeCount >= sharedLimit) {
        return failure({
          type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
          clientAccountId: client_account_id,
          currentCount: activeCount,
          limit: sharedLimit,
        });
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

      const sharedAt = new Date();
      const expiresAt = calculateExpiresAt(
        SESSION_CONTAINER_CONFIG.SESSION_EXPIRY_DAYS
      );

      // DECISION (nie usuwaj tego komentarza):
      // SC-6 atomic compare-and-swap: conditional updateMany WHERE lifecycle_state
      // IN (DRAFT,READY). The in-TX re-fetch above narrows the TOCTOU window but a
      // bare update-by-id under READ COMMITTED still lets two concurrent SHAREs
      // both write SHARED (no row lock on SELECT). Folding the state predicate into
      // the UPDATE makes the transition a single atomic statement — only ONE writer
      // matches rows; the loser gets count=0 → rollback → INVALID_STATE. Same idiom
      // as the recovery-window atomic updateMany (DOMAIN_SSOT §13.1).
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

      // POST-UPDATE VERIFY: re-count active sessions after marking SHARED.
      // This session is now SHARED with a future expires_at, so it correctly
      // counts itself as one occupied slot (SC-4 filter excludes only stale ones).
      // NIE jest to per-client race backstop: pod READ COMMITTED kazda rownolegla TX
      // widzi tylko swoj +1, wiec dwie rozne sesje tej samej klientki przejda VERIFY
      // niezaleznie. Strukturalny strop = partial-unique pair index x MAX_PAIRED_STYLISTS
      // == SESSION_MAX_ACTIVE_PER_CLIENT (patrz DECISION na poczatku TX). Ten re-count
      // lapie jedynie stan widoczny WLASNEJ TX (np. SC-4 sweep) — defense-in-depth.
      const finalActiveCount = await tx.sessionContainer.count({
        where: {
          client_account_id,
          lifecycle_state: { in: [...SHARED_STATES_FOR_PRISMA] },
          ...notExpiredFilter,
        },
      });
      if (finalActiveCount > sharedLimit) {
        throw new Error('__SHARE_ACTIVE_RACE__');
      }

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
