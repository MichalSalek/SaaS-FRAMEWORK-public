// Duplicate a terminal session as a single atomic, new client-private session.
import { DB_CLIENT } from '@app/db/db.client';
import { lockUserRow } from '@app/db/lock-rows';
import { databaseFailure } from '@app/errors/error-result.helpers';
import {
  failure,
  success,
  type OperationResult,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { SESSION_CONTAINER_CONFIG } from '@kernel/domain/session-container/session-container.config';
import { isSharedSessionLimitReached } from '@kernel/domain/session-container/session-container.limit';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { SessionContainerLifecycleStateValue as State } from '@kernel/models/db_models.generated.dto';
import type {
  SessionContainerInvalidStateError,
  SessionContainerMaxActiveExceededError,
  SessionContainerNotAuthorizedError,
  SessionContainerNotFoundError,
  SessionContainerNotPairedError,
  SessionContainerPairSessionExistsError,
  SessionContainerPhotoOwnershipError,
} from '@kernel/domain/session-container/session-container-errors.types';
import { canUseSalonPhotoInSession_IO } from '@domain/pairing/salon-access.resolver';
import {
  countSessionsTowardSharedLimit_IO,
  findActivePairing,
  isSalonReachedStylist_IO,
} from './session-container-shared.operations';
import {
  assertNoOtherOpenPairSession,
  findOtherOpenPairSessionId,
  PairSessionExistsInTxError,
} from './session-container-pair-session.helper';
import {
  classifyUniqueConstraintViolation,
  isP2002,
} from './session-container-concurrency.helper';
import { loadSessionDetail_IO } from './session-container-queries.operations';

type DuplicateError =
  | SessionContainerNotFoundError
  | SessionContainerNotAuthorizedError
  | SessionContainerInvalidStateError
  | SessionContainerNotPairedError
  | SessionContainerMaxActiveExceededError
  | SessionContainerPhotoOwnershipError
  | SessionContainerPairSessionExistsError
  | DatabaseError;

export const duplicateSessionContainer_IO = async ({
  client_user_id,
  client_account_id,
  session_id,
}: {
  client_user_id: string;
  client_account_id: string;
  session_id: string;
}): Promise<OperationResult<SessionContainerDetailDTO, DuplicateError>> => {
  const collision = { stylist: null as string | null };
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      // Matches create's client quota lock and serializes competing creates.
      await lockUserRow(tx, client_user_id);
      const source = await tx.sessionContainer.findFirst({
        where: { id: session_id, client_account_id },
        select: {
          id: true,
          name: true,
          client_note: true,
          stylist_account_id: true,
          lifecycle_state: true,
          photos: {
            select: { gallery_record_id: true },
            orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
          },
        },
      });
      if (!source) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_FOUND',
          sessionId: session_id,
        });
      }
      if (
        source.lifecycle_state !== State.CLOSED &&
        source.lifecycle_state !== State.EXPIRED
      ) {
        return failure({
          type: 'SESSION_CONTAINER_INVALID_STATE',
          sessionId: session_id,
          currentState: source.lifecycle_state,
          attemptedAction: 'duplicate',
        });
      }
      let stylist = source.stylist_account_id;
      if (stylist && !(await findActivePairing(client_user_id, stylist, tx))) {
        return failure({
          type: 'SESSION_CONTAINER_NOT_PAIRED',
          clientUserId: client_user_id,
          stylistAccountId: stylist,
        });
      }
      if (stylist) {
        collision.stylist = stylist;
        await assertNoOtherOpenPairSession(tx, {
          client_account_id,
          stylist_account_id: stylist,
          session_id,
        });
      }
      const outsideLimit =
        stylist !== null &&
        (await isSalonReachedStylist_IO(tx, client_user_id, stylist));
      if (!outsideLimit) {
        const count = await countSessionsTowardSharedLimit_IO(
          tx,
          client_user_id,
          client_account_id
        );
        if (isSharedSessionLimitReached(count)) {
          return failure({
            type: 'SESSION_CONTAINER_MAX_ACTIVE_EXCEEDED',
            clientAccountId: client_account_id,
            currentCount: count,
            limit: SESSION_CONTAINER_CONFIG.SESSION_MAX_ACTIVE_PER_CLIENT,
          });
        }
      }
      // Only missing or moderation-hidden photos are deliberately skipped. Every
      // other failed guard aborts the whole copy before any write.
      const photos: string[] = [];
      const records = await tx.galleryRecord.findMany({
        where: {
          gallery_record_id: {
            in: source.photos.map(photo => photo.gallery_record_id),
          },
        },
        select: {
          gallery_record_id: true,
          created_by_account_id: true,
          is_hidden: true,
        },
      });
      const recordsById = new Map(
        records.map(record => [record.gallery_record_id, record])
      );
      const verifiedAuthors = new Set<string>();
      for (const photo of source.photos) {
        const record = recordsById.get(photo.gallery_record_id);
        if (!record || record.is_hidden) {
          continue;
        }
        const effectiveStylist = stylist ?? record.created_by_account_id;
        if (
          !stylist &&
          !(await findActivePairing(client_user_id, effectiveStylist, tx))
        ) {
          return failure({
            type: 'SESSION_CONTAINER_NOT_PAIRED',
            clientUserId: client_user_id,
            stylistAccountId: effectiveStylist,
          });
        }
        if (
          stylist &&
          !verifiedAuthors.has(record.created_by_account_id) &&
          !(await canUseSalonPhotoInSession_IO(
            client_user_id,
            stylist,
            record.created_by_account_id,
            tx
          ))
        ) {
          return failure({
            type: 'SESSION_CONTAINER_PHOTO_OWNERSHIP',
            sessionId: session_id,
            galleryRecordId: record.gallery_record_id,
            expectedStylistAccountId: stylist,
          });
        }
        verifiedAuthors.add(record.created_by_account_id);
        if (!stylist) {
          stylist = effectiveStylist;
          collision.stylist = stylist;
          await assertNoOtherOpenPairSession(tx, {
            client_account_id,
            stylist_account_id: stylist,
            session_id,
          });
        }
        photos.push(record.gallery_record_id);
      }
      const created = await tx.sessionContainer.create({
        data: {
          client_account_id,
          stylist_account_id: stylist,
          name: source.name,
          client_note: source.client_note?.trim() ? source.client_note : null,
          lifecycle_state: photos.length ? State.READY : State.DRAFT,
        },
      });
      if (photos.length) {
        await tx.sessionContainerPhoto.createMany({
          data: photos.map((gallery_record_id, position) => ({
            session_id: created.id,
            gallery_record_id,
            position,
          })),
        });
      }
      const detail = await loadSessionDetail_IO(created.id, 'client', tx);
      // loadSessionDetail returns an error value; throw to roll back the writes.
      if (!detail.success) {
        throw new Error(`Duplicate detail failed: ${detail.error.type}`);
      }
      return success({ ...detail.data, can_accept: false });
    });
  } catch (error) {
    if (error instanceof PairSessionExistsInTxError) {
      return failure({
        type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS',
        sessionId: session_id,
        stylistAccountId: error.stylistAccountId,
        existingSessionId: error.existingSessionId,
      });
    }
    if (
      collision.stylist !== null &&
      isP2002(error) &&
      classifyUniqueConstraintViolation(error) === 'active_pair'
    ) {
      const stylistAccountId = collision.stylist;
      return failure({
        type: 'SESSION_CONTAINER_PAIR_SESSION_EXISTS',
        sessionId: session_id,
        stylistAccountId,
        existingSessionId: await findOtherOpenPairSessionId({
          client_account_id,
          stylist_account_id: stylistAccountId,
          session_id,
        }),
      });
    }
    return databaseFailure('duplicateSessionContainer:transaction', error);
  }
};
