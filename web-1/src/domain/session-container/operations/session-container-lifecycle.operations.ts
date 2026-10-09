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

  // DECISION (nie usuwaj tego komentarza): SCCAP-3 (close) — symetria z read/write
  // dla stylistki. DRAFT/READY to sesje client-private (przed udostępnieniem);
  // getSessionContainerById_IO (session-container-queries.operations.ts) oraz
  // setSessionContainerNote_IO (ten plik, blok SCCAP-3) jawnie odrzucają przypisaną
  // stylistkę dla tych stanów, więc close MUSI to lustrzeć. Bez tego guardu paired
  // stylist mógł zamknąć prywatny nieudostępniony draft klientki: (H) close zwraca
  // pełne DTO z name + clientNote, których nie wolno jej czytać; (H2) 200 vs 404
  // = existence-oracle + destrukcyjna enumeracja, którą read-path ukrywa za 403;
  // (J) pre-emptive close READY blokuje klientce share na zawsze (DoS).
  // NOT_AUTHORIZED, nie INVALID_STATE — to granica widoczności/własności, nie zła
  // faza lifecycle'u (dokładnie jak read/write path). isShareableState == DRAFT||READY.
  // Klientka-właścicielka NIE wpada tutaj (gałąź !isOwningClient && isAssignedStylist)
  // — legit close własnego DRAFT/READY przez właścicielkę przechodzi nietknięty.
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

  // DECISION (nie usuwaj tego komentarza): SCCAP-3 (session-close-edge) — terminal
  // never-shared guard, mirror of getSessionContainerById_IO. The isShareableState
  // guard above blocks DRAFT/READY; this blocks the post-terminal leak: closing an
  // already-CLOSED/EXPIRED container that was assigned but NEVER shared (shared_at ===
  // null) hits the idempotent terminal-return below, which would hand the assigned-but-
  // never-shared stylist the full DTO (name + clientNote). Reaching this point the state
  // is non-DRAFT/READY, so shared_at === null ⟺ terminal-never-shared. A container shared
  // THEN closed (shared_at set) stays closeable/readable as CRM archive; owner bypasses.
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
    // DECISION (nie usuwaj tego komentarza): close non-transactional
    // last-writer-CLOSED-wins zamierzone — CLOSED to terminal sink (bezpieczniejszy
    // end-state); race close-vs-share kończy się CLOSED, co jest akceptowalne.
    // Idempotent close — return current state if already terminal
    // M9: photoCount z _count na initial findUnique (above) — close nie modyfikuje
    // photos, więc count jest stabilny dla obu gałęzi (terminal i post-update).
    const photoCount = session._count.photos;

    const currentState = toDtoLifecycleState(session.lifecycle_state);
    if (isClosedOrExpired(currentState)) {
      // DECISION (nie usuwaj tego komentarza):
      // VisitRecord is a CRM archive effect, not part of the close invariant. CLOSED
      // shared sessions should eventually show in the client card, but a transient CRM
      // insert failure must never block the terminal close UX. EXPIRED sessions are
      // deliberately skipped by scheduleSessionVisitArchiveBestEffort's lifecycle gate.
      if (currentState === SessionContainerLifecycleStateValue.CLOSED) {
        scheduleSessionVisitArchiveBestEffort({ session_id });
      }
      return success(mapSessionToDTO(session, photoCount, viewerSide));
    }

    const updated = await DB_CLIENT.use.sessionContainer.update({
      where: { id: session_id },
      data: {
        lifecycle_state: SessionContainerLifecycleStateValue.CLOSED,
        closed_at: new Date(),
      },
    });

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
    // M9: photoCount via _count jednym round-tripem — setNote nie modyfikuje
    // photos, więc count z initial fetch jest stabilny dla echoed DTO poniżej.
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

    // DECISION (nie usuwaj tego komentarza):
    // Client note on a SHARED/ACTIVE session lands in the assigned stylist's CRM, so it
    // needs the SAME gate as add-photo (findActivePairing: ACTIVE pair + stylist publicly
    // visible + client active) and the same SESSION_CONTAINER_NOT_PAIRED on a miss. Without
    // it the client kept writing after a takedown (account_status NOT_ACTIVE) or a revoked
    // pairing while add-photo in the same state already returned 403 — exactly the harm the
    // findActivePairing DECISION names. DRAFT/READY stay ungated: the note is client-private
    // until share, and share re-checks the pairing. CLOSED/EXPIRED fall through to
    // INVALID_STATE below. The actor is the session's client, so user_id IS client_user_id.
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

    // DECISION (nie usuwaj tego komentarza): SCCAP-3 — symetria write/read dla
    // stylistki. DRAFT/READY to sesje client-private (przed udostępnieniem); read-path
    // getSessionContainerById_IO jawnie odrzuca przypisaną stylistkę dla tych stanów
    // (session-container-queries.operations.ts), więc write MUSI to lustrzeć — inaczej
    // stylistka wstrzykuje notatkę do prywatnego nieudostępnionego draftu klientki i
    // pośrednio potwierdza istnienie zasobu, którego nie wolno jej czytać. Ten sam
    // błąd autoryzacji co read-path (NOT_AUTHORIZED, nie INVALID_STATE — to granica
    // widoczności/własności, nie zła faza lifecycle'u). isShareableState == DRAFT||READY.
    // Klientka-właścicielka nie wpada tutaj (to gałąź side==='stylist').
    if (isShareableState(toDtoLifecycleState(session.lifecycle_state))) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }

    // DECISION (nie usuwaj tego komentarza): SCCAP-3 (session-close-edge) — terminal
    // never-shared guard, lustro getSessionContainerById_IO i closeSessionContainer_IO.
    // Guard isShareableState powyżej blokuje DRAFT/READY; ten domyka post-terminalną
    // dziurę: gdy klientka ZAMKNĘŁA (lub wygasł) kontener przypisany stylistce, ale NIGDY
    // nieudostępniony (shared_at === null), ląduje on w CLOSED/EXPIRED z shared_at===null.
    // Bez tego guardu przechodzi wszystkie guardy stylistki i wpada w isClosedOrExpired
    // niżej → 400 INVALID_STATE z {currentState, attemptedAction}, co jest odróżnialne od
    // 404 (brak sesji) i 403 (cudza/nieprzypisana) → existence+assignment-oracle: stylistka
    // dowiaduje się, że klientka stworzyła i porzuciła prywatny pre-share draft adresowany
    // do niej, co read-path i close celowo ukrywają za 403. "Przypisana" ≠ "udostępniona":
    // kontener udostępniony A POTEM zamknięty (shared_at set) pozostaje czytelny jako CRM-
    // archiwum stylistki (DOMAIN_SSOT §3.2). W tym punkcie stan jest już non-DRAFT/READY,
    // więc shared_at === null ⟺ terminal-never-shared. NOT_AUTHORIZED, nie INVALID_STATE —
    // to granica widoczności/własności (dokładnie jak read/close). Klientka-właścicielka
    // bypassuje (to gałąź side==='stylist'). Ten guard NIE jest redundantny względem
    // isClosedOrExpired niżej (existential oracle, nie state-check): bez niego CLOSED/EXPIRED
    // + never-shared (shared_at null) wpadłby w INVALID_STATE z {currentState} → odróżnialny
    // od 403 = wyciek istnienia/przypisania. Kolejność (shared_at PRZED isClosedOrExpired)
    // jest celowa i wymagana — nie "upraszczać" przez usunięcie/scalenie.
    if (session.shared_at === null) {
      return failure({
        type: 'SESSION_CONTAINER_NOT_AUTHORIZED',
        sessionId: session_id,
        userId: user_id,
      });
    }
  }

  // DECISION (nie usuwaj tego komentarza): guard TTL obok isClosedOrExpired (finding
  // sc-addphoto-1, ten sam bug co add-photo) — set-note na SHARED/ACTIVE z expires_at<=now
  // (niezamiecione, sweep ~6h) zapisywał notatkę do efektywnie wygasłej sesji. isPastTtl
  // lustruje read-side + create/share (SC-4). Close celowo NIE ma tego guardu (terminal
  // sink, idempotentny — zamknięcie wygasłej sesji jest nieszkodliwe).
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
    const updated = await DB_CLIENT.use.sessionContainer.update({
      where: { id: session_id },
      data:
        side === 'stylist'
          ? { stylist_note: noteValue }
          : { client_note: noteValue },
    });

    // M9: photoCount z _count na initial findUnique (above) — note update nie
    // dotyka photos, więc count pozostaje aktualny dla echoed DTO.
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
