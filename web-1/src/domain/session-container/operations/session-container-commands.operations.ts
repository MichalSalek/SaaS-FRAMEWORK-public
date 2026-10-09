/**
 * SessionContainer COMMAND operations (R8)
 *
 * Commands: create
 * (addPhoto is in session-container-add-photo.operation.ts;
 *  share + close + setNote are in session-container-lifecycle.operations.ts)
 */

import { DB_CLIENT } from '@app/db/db.client';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { SessionContainerDTO } from '@kernel/models/session-container/session-container.dto';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  SessionContainerMaxActiveExceededError,
  SessionContainerNotPairedError,
} from '@kernel/domain/session-container/session-container-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { isP2003 } from '@app/db/prisma-error';
import {
  mapSessionToDTO,
  findActivePairing,
  SHARED_STATES_FOR_PRISMA,
} from './session-container-shared.operations';
import { isP2002 } from './session-container-concurrency.helper';

// ─── 1. CREATE ────────────────────────────────────────────────────────────

export const createSessionContainer_IO = async ({
  client_user_id,
  client_account_id,
  stylist_account_id,
  name,
}: {
  client_user_id: string;
  client_account_id: string;
  stylist_account_id?: string | undefined;
  name?: string | undefined;
}): Promise<
  OperationResult<
    SessionContainerDTO,
    | SessionContainerNotPairedError
    | SessionContainerMaxActiveExceededError
    | DatabaseError
  >
> => {
  // If stylist provided — must be paired. Checked ONCE before the create-retry loop:
  // a revoked pairing does not recover on retry.
  try {
    if (stylist_account_id) {
      const pair = await findActivePairing(client_user_id, stylist_account_id);
      if (!pair) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId: stylist_account_id,
        });
      }
    }
  } catch (error) {
    return databaseFailure('createSessionContainer:pairingCheck', error);
  }

  const limit = SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT;

  // DECISION (nie usuwaj tego komentarza): SC-2 (finding session-container-2) — bounded
  // create-retry. Dwa zrodla P2002 na partial-unique session_container_active_pair_uq:
  //   (a) zwyciezca wyscigu wciaz ZYWY → zwroc go idempotentnie (klientka wraca do biezacej
  //       sesji z ta stylistka; loyalty §5A.1 "1 sesja = 1 wizyta"),
  //   (b) zwyciezca przeszedl do stanu TERMINALNEGO (CLOSED/EXPIRED) w mikro-oknie miedzy
  //       odrzuceniem przez index a re-fetchem → winner==null. WCZESNIEJ to bylo 500
  //       (finding session-container-2). To NIE jest bug do oddania userowi: slot na nowa pare
  //       jest juz WOLNY, wiec PONAWIAMY create (kolejna iteracja przejdzie czysto bo zadna
  //       niesterminalna sesja tej pary nie istnieje). Bounded do 3 prob — to skrajnie rzadki
  //       wyscig, a kazda iteracja albo zwraca zywego zwyciezce, albo tworzy nowa sesje.
  const MAX_CREATE_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    try {
      return await DB_CLIENT.use.$transaction(async tx => {
        // SC-2 invariant pary (DOMAIN_SSOT §3.2): max 1 niesterminalna sesja per para. Jesli
        // juz istnieje, zwroc ja idempotentnie. Twardym backstopem race'a jest partial-unique
        // index session_container_active_pair_uq (obsluzony w catch).
        if (stylist_account_id) {
          const existingPair = await tx.sessionContainer.findFirst({
            where: {
              client_account_id,
              stylist_account_id,
              lifecycle_state: {
                notIn: [
                  SessionContainerLifecycleStateValue.CLOSED,
                  SessionContainerLifecycleStateValue.EXPIRED,
                ],
              },
            },
          });
          if (existingPair) {
            const existingPhotoCount = await tx.sessionContainerPhoto.count({
              where: { session_id: existingPair.id },
            });
            return success(mapSessionToDTO(existingPair, existingPhotoCount));
          }
        }

        // DECISION (nie usuwaj tego komentarza): SC-1 cap po osi PER-CLIENT (nie
        // per-stylist) — liczymy żywe (SHARED/ACTIVE, nieprzeterminowane) sesje TEJ
        // KLIENTKI, max 3 równolegle (DOMAIN_SSOT §3.2). Świeży rekord jest DRAFT (nie
        // liczy się do [SHARED,ACTIVE]) — pełna quota egzekwowana przy SHARE; ten count
        // to tani wczesny guard, gdy klientka już ma 3 żywe sesje. SC-4: filtr expires_at
        // mirroruje read-side (getMySessionContainers_IO), by przeterminowane-niezamiecione
        // nie zawyżały licznika.
        const now = new Date();
        const notExpiredFilter = {
          OR: [{ expires_at: null }, { expires_at: { gt: now } }],
        };
        const activeCount = await tx.sessionContainer.count({
          where: {
            client_account_id,
            lifecycle_state: { in: [...SHARED_STATES_FOR_PRISMA] },
            ...notExpiredFilter,
          },
        });
        if (activeCount >= limit) {
          return failure({
            type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
            clientAccountId: client_account_id,
            currentCount: activeCount,
            limit,
          });
        }

        const created = await tx.sessionContainer.create({
          data: {
            client_account_id,
            stylist_account_id: stylist_account_id ?? null,
            name: name ?? null,
            lifecycle_state: SessionContainerLifecycleStateValue.DRAFT,
          },
        });

        return success(mapSessionToDTO(created, 0));
      });
    } catch (error) {
      lastError = error;
      // DECISION (nie usuwaj tego komentarza): P2002 wykrywany STRUKTURALNIE (isP2002 →
      // hasCode/error.code), NIE `instanceof Prisma.PrismaClientKnownRequestError` —
      // instanceof zwraca FALSE pod Turbopack (zdublowane tożsamości klasy między
      // realizacjami modułu) → ta gałąź idempotentna BYŁA PRZESKAKIWANA i współbieżny
      // create dla tej samej pary spadał do databaseFailure → 500 GENERAL_ERROR zamiast
      // idempotentnego zwycięzcy (201) — potwierdzone LIVE round-2 (przegrani wyścigu 54/100
      // × 500). Reużywamy domenowy isP2002 z sąsiada (session-container-concurrency.helper,
      // ta sama domena); pełny rationale: @app/db/prisma-error.ts.
      // SC-2: równoległy create dla tej samej pary (client, stylist) przegrał wyścig z
      // partial-unique index. Re-fetch zwycięzcy i zwróć go idempotentnie.
      if (stylist_account_id && isP2002(error)) {
        const winner = await DB_CLIENT.use.sessionContainer.findFirst({
          where: {
            client_account_id,
            stylist_account_id,
            lifecycle_state: {
              notIn: [
                SessionContainerLifecycleStateValue.CLOSED,
                SessionContainerLifecycleStateValue.EXPIRED,
              ],
            },
          },
        });
        if (winner) {
          const winnerPhotoCount =
            await DB_CLIENT.use.sessionContainerPhoto.count({
              where: { session_id: winner.id },
            });
          return success(mapSessionToDTO(winner, winnerPhotoCount));
        }
        // winner==null: zwycieska sesja poszla do stanu terminalnego w mikro-oknie → slot
        // wolny → PONAWIAMY create (nastepna iteracja przejdzie czysto). NIE oddajemy 500.
        continue;
      }
      // DECISION (nie usuwaj tego komentarza): P2003 (FK) on create = the referenced
      // stylist account vanished between the pairing check above and the insert (account
      // purge racing the create). The pairing no longer holds, so this is the domain
      // NOT_PAIRED verdict, not a server fault — before, it escaped as an opaque 500.
      if (stylist_account_id && isP2003(error)) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId: stylist_account_id,
        });
      }
      return databaseFailure('createSessionContainer', error);
    }
  }

  // Wyczerpano proby (skrajnie patologiczny wyscig terminal↔create). Honest last-resort.
  return databaseFailure(
    'createSessionContainer:max-attempts-exceeded',
    lastError
  );
};
