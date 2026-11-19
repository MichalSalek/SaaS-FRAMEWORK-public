import { lockSessionActivityContext } from '../session-activity.lock';
import { writeSessionNoteLocked_IO } from './session-container-note-write.operation';
/**
 * SessionContainer lifecycle operations (R8)
 *
 * Close + SetNote — split from commands to stay under ESLint max-lines.
 * SHARE moved to session-container-share.operation.ts for the same reason;
 * re-exported here to preserve the existing public API of the operations
 * barrel.
 */
import { DB_CLIENT } from '@app/db/db.client';
import {
  SessionContainerLifecycleStateValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  SessionContainerInvalidStateError,
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
  SessionContainerNotPairedError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  mapSessionToDTO,
  toDtoLifecycleState,
  isClosedOrExpired,
  isPastTtl,
  isShareableState,
  resolveViewerSide,
  findActivePairing,
  SHARED_STATES_FOR_PRISMA,
} from './session-container-shared.operations';
import { scheduleSessionVisitArchiveBestEffort } from '@domain/visit/operations/visit-session-archive.operations';
export { shareSessionContainer_IO } from './session-container-share.operation';
// ─── 4. CLOSE ─────────────────────────────────────────────────────────────
export const closeSessionContainer_IO = async ({
  client_account_id,
  stylist_account_id,
  session_id,
  user_id,
}: {
  client_account_id: string | undefined;
  stylist_account_id: string | undefined;
  session_id: string;
  user_id: string;
}): Promise<
  OperationResult<
    SessionContainerDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | DatabaseError
  >
> => {
  let session;
  try {
    // M9: pobierz photoCount jednym round-tripem (_count) zamiast osobnych
    // sessionContainerPhoto.count w gałęziach terminal/post-update poniżej.
    session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      include: { _count: { select: { photos: true } } },
    });
  } catch (error) {
    return databaseFailure('closeSessionContainer', error);
  }
  if (!session) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_FOUND',
      sessionId: session_id,
    });
  }
  // Either the owning client OR the assigned stylist (with active pairing) may close.
  const isOwningClient =
    Boolean(client_account_id) &&
    session.client_account_id === client_account_id;
  let isAssignedStylist = false;
  if (
    !isOwningClient &&
    stylist_account_id &&
    session.stylist_account_id === stylist_account_id
  ) {
    // SCCAP-K1: wrap the authorization reads so a DB failure yields a controlled
    // DATABASE_ERROR (mirrors the findUnique guard above), not an uncaught throw.
    try {
      const clientAccount = await DB_CLIENT.use.clientAccount.findUnique({
        where: { client_account_id: session.client_account_id },
        select: { created_by_user_id: true },
      });
      const activePairing = clientAccount
        ? await DB_CLIENT.use.clientStylistPair.findFirst({
            where: {
              client_user_id: clientAccount.created_by_user_id,
              stylist_account_id,
              status: PairingStatusValue.ACTIVE,
              // SM-1: a self soft-deleted client (is_active=false) leaves the pairing
              // row ACTIVE (DOMAIN_SSOT §13.1), so status alone would still let the
              // assigned stylist mutate her container. Mirror the visit/contact/CRM
              // guard (visit-common findActivePairing, client-profile is_active gate)
              // so a stylist stops mutating a soft-deleted client's session.
              client_user: { is_active: true },
            },
            select: { id: true },
          })
        : null;
      isAssignedStylist = activePairing !== null;
    } catch (error) {
      return databaseFailure('closeSessionContainer', error);
    }
  }
  if (!isOwningClient && !isAssignedStylist) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }

  if (
    !isOwningClient &&
    isAssignedStylist &&
    isShareableState(toDtoLifecycleState(session.lifecycle_state))
  ) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }
  // DECISION: terminal never-shared guard, mirror of getSessionContainerById_IO (full rationale there). The isShareableState
  // guard above blocks DRAFT/READY; this blocks the post-terminal leak: closing an already CLOSED/EXPIRED container that was
  // assigned but NEVER shared (shared_at === null) hits the idempotent terminal return below and would hand the stylist the
  // full DTO (name + clientNote). A container shared THEN closed (shared_at set) stays closeable/readable as CRM archive;
  // the owner bypasses.
  if (!isOwningClient && isAssignedStylist && session.shared_at === null) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
      sessionId: session_id,
      userId: user_id,
    });
  }
  // Read-side field masking on the returned DTO: reveal stylistNote only when the
  // closer is the assigned stylist (and not the owning client). Owning client →
  // masked (DOMAIN_SSOT §3.2). Mirrors get-by-id viewer-side resolution.
  const viewerSide =
    !isOwningClient && isAssignedStylist
      ? resolveViewerSide({
          sessionStylistAccountId: session.stylist_account_id,
          viewerStylistAccountId: stylist_account_id,
        })
      : 'client';
  try {
    // DECISION: close now takes the shared session activity locks; last-writer-CLOSED-wins remains intended: CLOSED is a terminal sink (the safer
    // end state), so a close-vs-share race ending CLOSED is acceptable.
    // Idempotent close — return current state if already terminal
    // photoCount comes from _count on the initial findUnique (above): close does not modify photos, so the count is stable
    // for both branches (terminal and post-update).
    const photoCount = session._count.photos;
    const currentState = toDtoLifecycleState(session.lifecycle_state);
    if (isClosedOrExpired(currentState)) {
      // DECISION: VisitRecord is a CRM archive effect, not part of the close invariant. CLOSED shared sessions should
      // eventually show in the client card, but a transient CRM insert failure must never block the terminal close UX. EXPIRED
      // sessions are deliberately skipped by the lifecycle gate of scheduleSessionVisitArchiveBestEffort.
      if (currentState === SessionContainerLifecycleStateValue.CLOSED) {
        scheduleSessionVisitArchiveBestEffort({ session_id });
      }
      return success(mapSessionToDTO(session, photoCount, viewerSide));
    }
    const closed = await DB_CLIENT.use.$transaction(async tx => {
      const activity = await lockSessionActivityContext(tx, session_id);
      if (!activity || (!isOwningClient && !activity.activePairId)) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_AUTHORIZED' as const,
          sessionId: session_id,
          userId: user_id,
        });
      }
      if (
        isClosedOrExpired(toDtoLifecycleState(activity.session.lifecycle_state))
      ) {
        return success(activity.session);
      }
      return success(
        await tx.sessionContainer.update({
          where: { id: session_id },
          data: {
            lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
            closed_at: new Date(),
          },
        })
      );
    });
    if (!closed.success) {
      return closed;
    }
    const updated = closed.data;
    scheduleSessionVisitArchiveBestEffort({ session_id });
    return success(mapSessionToDTO(updated, photoCount, viewerSide));
  } catch (error) {
    return databaseFailure('closeSessionContainer', error);
  }
};
// ─── 5. SET NOTE ──────────────────────────────────────────────────────────
export const setSessionContainerNote_IO = async ({
  session_id,
  note,
  side,
  client_account_id,
  stylist_account_id,
  user_id,
}: {
  session_id: string;
  note: string;
  side: 'client' | 'stylist';
  client_account_id: string | undefined;
  stylist_account_id: string | undefined;
  user_id: string;
}): Promise<
  OperationResult<
    SessionContainerDTO,
    | SessionContainerNotFoundError
    | SessionContainerNotAuthorizedError
    | SessionContainerNotPairedError
    | SessionContainerInvalidStateError
    | DatabaseError
  >
> => {
  let session;
  try {
    // photoCount comes from _count on this fetch. setNote does not change
    // photos, so the count stays valid for the echoed DTO below.
    session = await DB_CLIENT.use.sessionContainer.findUnique({
      where: { id: session_id },
      include: { _count: { select: { photos: true } } },
    });
  } catch (error) {
    return databaseFailure('setSessionContainerNote', error);
  }
  if (!session) {
    return failure({
      type: 'SESSION_CONTAINER_NOT_FOUND',
      sessionId: session_id,
    });
  }
  // Authorization — side must match the actor's account
  if (side === 'client') {
    if (!client_account_id || session.client_account_id !== client_account_id) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
    // DECISION: a client note on a SHARED/ACTIVE session lands in the assigned stylist's CRM, so it needs the SAME gate as
    // add-photo (findActivePairing: ACTIVE pair + stylist publicly visible + client active) and the same
    // SESSION_CONTAINER_NOT_PAIRED on a miss. Without it the client kept writing after a takedown (account_status NOT_ACTIVE)
    // or a revoked pairing while add-photo in the same state already returned 403. DRAFT/READY stay ungated: the note is
    // client-private until share, and share re-checks the pairing. CLOSED/EXPIRED fall through to INVALID_STATE below. The
    // actor is the session's client, so user_id IS client_user_id.
    const stylistAccountId = session.stylist_account_id;
    const isSharedWithStylist = SHARED_STATES_FOR_PRISMA.some(
      state => state === session.lifecycle_state
    );
    if (stylistAccountId && isSharedWithStylist) {
      let pair;
      try {
        pair = await findActivePairing(user_id, stylistAccountId);
      } catch (error) {
        return databaseFailure('setSessionContainerNote:pairingCheck', error);
      }
      if (!pair) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: user_id,
          stylistAccountId,
        });
      }
    }
  } else {
    if (
      !stylist_account_id ||
      session.stylist_account_id !== stylist_account_id
    ) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
    // SCCAP-2: ujednolicono z close/share/addPhoto — stylistka moze zapisac note
    // tylko przy AKTYWNYM pairingu z klientka-wlascicielka sesji (sam przypisany
    // stylist_account_id nie wystarcza). Brak aktywnego pairingu -> ten sam blad
    // autoryzacji co przy close. Pattern inline jak w closeSessionContainer_IO.
    let activePairing;
    try {
      const clientAccount = await DB_CLIENT.use.clientAccount.findUnique({
        where: { client_account_id: session.client_account_id },
        select: { created_by_user_id: true },
      });
      activePairing = clientAccount
        ? await DB_CLIENT.use.clientStylistPair.findFirst({
            where: {
              client_user_id: clientAccount.created_by_user_id,
              stylist_account_id,
              status: PairingStatusValue.ACTIVE,
              // SM-1: a self soft-deleted client (is_active=false) leaves the pairing
              // row ACTIVE (DOMAIN_SSOT §13.1), so status alone would still let the
              // assigned stylist mutate her container. Mirror the visit/contact/CRM
              // guard (visit-common findActivePairing, client-profile is_active gate)
              // so a stylist stops mutating a soft-deleted client's session.
              client_user: { is_active: true },
            },
            select: { id: true },
          })
        : null;
    } catch (error) {
      return databaseFailure('setSessionContainerNote', error);
    }
    if (activePairing === null) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
    // DECISION: write/read symmetry for the stylist. DRAFT/READY are client-private sessions; the read path
    // getSessionContainerById_IO rejects the assigned stylist for those states (session-container-queries.operations.ts), so
    // write MUST mirror it, or she injects a note into a client's private draft and indirectly confirms the existence of a
    // resource she may not read. The same NOT_AUTHORIZED as the read path (a visibility/ownership boundary, not a wrong
    // lifecycle phase). isShareableState == DRAFT||READY. The owning client does not land here (branch side==='stylist').
    if (isShareableState(toDtoLifecycleState(session.lifecycle_state))) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
    // DECISION: terminal never-shared guard, mirror of getSessionContainerById_IO and closeSessionContainer_IO (full
    // rationale in the former). The isShareableState guard above blocks DRAFT/READY; this closes the post-terminal hole: a
    // container the client CLOSED (or that expired) while assigned but NEVER shared (shared_at === null) would pass the
    // stylist guards and reach isClosedOrExpired below as a 400 INVALID_STATE with {currentState, attemptedAction}, which is
    // distinguishable from 404 and 403: an existence + assignment oracle for a private pre-share draft addressed to her.
    // "Assigned" != "shared": a container shared THEN closed (shared_at set) stays readable as her CRM archive (DOMAIN_SSOT
    // §3.2). NOT_AUTHORIZED, not INVALID_STATE. The client-owner bypasses. The order (shared_at BEFORE isClosedOrExpired) is
    // required, so do not simplify it by removing or merging.
    if (session.shared_at === null) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
  }
  // DECISION: a TTL guard next to isClosedOrExpired (same bug as add-photo): set-note on SHARED/ACTIVE with expires_at<=now
  // (not yet swept, sweep ~6h) wrote a note to an effectively expired session. isPastTtl mirrors the read side and
  // create/share. Close deliberately has NO such guard (terminal sink, idempotent: closing an expired session is harmless).
  const currentState = toDtoLifecycleState(session.lifecycle_state);
  if (isClosedOrExpired(currentState) || isPastTtl(session.expires_at)) {
    return failure({
      type: 'SESSION_CONTAINER_INVALID_STATE',
      sessionId: session_id,
      currentState,
      attemptedAction: 'SET_NOTE',
    });
  }
  // Empty string = clear the note.
  const trimmed = note.trim();
  const noteValue: string | null = trimmed.length > 0 ? trimmed : null;
  try {
    const saved = await DB_CLIENT.use.$transaction(tx =>
      writeSessionNoteLocked_IO(tx, {
        sessionId: session_id,
        userId: user_id,
        side,
        noteValue,
      })
    );
    if (!saved.success) {
      return saved;
    }
    const updated = saved.data;
    // photoCount comes from _count on the initial findUnique above. The note
    // update does not touch photos, so the count stays valid for the echoed DTO.
    const photoCount = session._count.photos;
    // Viewer-side masking on the echoed DTO: the writer's `side` IS the viewer
    // here (authorization above proved the actor owns that side). A stylist writer
    // sees her own stylistNote; a client writer gets it masked (DOMAIN_SSOT §3.2),
    // so the set-note response can never leak stylistNote back to the client
    // (closes the echo vector of Finding #1 on this endpoint too).
    const viewerSide = side === 'stylist' ? 'stylist' : 'client';
    return success(mapSessionToDTO(updated, photoCount, viewerSide));
  } catch (error) {
    return databaseFailure('setSessionContainerNote', error);
  }
};
