import { lockUserRow } from '@app/db/lock-rows';
/**
 * SessionContainer COMMAND operations (R8)
 *
 * Commands: create
 * (addPhoto is in session-container-add-photo.operation.ts;
 *  share + close + setNote are in session-container-lifecycle.operations.ts)
 */

import { DB_CLIENT } from '@app/db/db.client';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { isSharedSessionLimitReached } from '@kernel/domain/session-container/session-container.limit';
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
  countSessionsTowardSharedLimit_IO,
  isSalonReachedStylist_IO,
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

  // DECISION: bounded create-retry. There are two sources of P2002 on the partial-unique session_container_active_pair_uq:
  //   (a) the race winner is still LIVE -> return it idempotently (the client returns to the current session with this
  //       stylist; loyalty §5A.1 "1 session = 1 visit");
  //   (b) the winner reached a TERMINAL state (CLOSED/EXPIRED) in the micro-window between the index rejection and the
  //       re-fetch -> winner==null. That used to be a 500. The slot for a new pair is already FREE, so the create is RETRIED
  //       (the next iteration passes because no non-terminal session of this pair exists). Bounded to 3 attempts: an
  //       extremely rare race, and each iteration either returns a live winner or creates a new session.
  const MAX_CREATE_ATTEMPTS = 3;
  let lastError: unknown;
  for (let attempt = 0; attempt < MAX_CREATE_ATTEMPTS; attempt++) {
    try {
      return await DB_CLIENT.use.$transaction(async tx => {
        // Salon-derived contacts exceed the direct pairing cap, so serialize the
        // per-client session quota explicitly instead of relying on pair count.
        await lockUserRow(tx, client_user_id);
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

        // DECISION: the cap is PER CLIENT (not per stylist): it counts THIS client's live (SHARED/ACTIVE, unexpired) sessions
        // (DOMAIN_SSOT §3.2). A fresh record is a DRAFT (not counted in [SHARED,ACTIVE]); the full quota is enforced at SHARE,
        // and this count is a cheap early guard. Sessions with salon stylists are OUTSIDE the limit (rule: kernel
        // session-container.limit.ts), so a session with such a stylist is created even at the cap.
        const outsideLimit =
          stylist_account_id !== undefined &&
          (await isSalonReachedStylist_IO(
            tx,
            client_user_id,
            stylist_account_id
          ));
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
              limit,
            });
          }
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
      // DECISION: P2002 is detected structurally (isP2002), not with instanceof (see
      // web-1/src/application/db/prisma-error.ts); otherwise a concurrent create for the same pair
      // fell to databaseFailure (500) instead of the idempotent winner (201).
      // A parallel create for the same (client, stylist) pair lost the race to the partial-unique index. Re-fetch the winner
      // and return it idempotently.
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
      // DECISION: P2003 (FK) on create = the referenced stylist account vanished between the pairing check above and the
      // insert (an account purge racing the create). The pairing no longer holds, so this is the domain NOT_PAIRED verdict,
      // not a server fault; it used to escape as an opaque 500.
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
