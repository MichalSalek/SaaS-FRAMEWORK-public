import { DB_CLIENT } from '@app/db/db.client';
import {
  type OperationResult,
  success,
  failure,
} from '@kernel/application/result.types';
import type {
  PairingCodeInvalidError,
  PairingSessionNotFoundError,
} from '@kernel/domain/pairing/pairing-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

/**
 * Revoke pairing session (stylist cancels token before claim)
 */
export const revokePairingSession_IO = async ({
  token,
  stylist_account_id,
}: {
  token: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    { success: true },
    PairingSessionNotFoundError | PairingCodeInvalidError | DatabaseError
  >
> => {
  // DECISION: race-safe revoke uses an atomic updateMany with a composite WHERE: token match, owner stylist match
  // (authorization), claimed_by_client_user_id IS NULL, revoked_at IS NULL. If count === 0 a follow-up SELECT finds
  // out WHY (not found / wrong owner / already claimed); wrong-owner is deliberately collapsed into the not-found
  // response (anti-enumeration, see the SECURITY note at the classification branch). This removes the TOCTOU
  // between check and update.
  let updateResult;
  try {
    updateResult = await DB_CLIENT.use.pairingSession.updateMany({
      where: {
        token,
        stylist_account_id,
        claimed_by_client_user_id: null,
        revoked_at: null,
      },
      data: { revoked_at: new Date() },
    });
  } catch (error) {
    return databaseFailure('revokePairingSession', error);
  }

  if (updateResult.count > 0) {
    return success({ success: true });
  }

  // count === 0: classify WHY using a single SELECT for an accurate error
  let session;
  try {
    session = await DB_CLIENT.use.pairingSession.findUnique({
      where: { token },
      select: {
        id: true,
        stylist_account_id: true,
        claimed_by_client_user_id: true,
        revoked_at: true,
      },
    });
  } catch (error) {
    return databaseFailure('revokePairingSession:classify', error);
  }

  // SECURITY (anti-enumeration): a non-owner probing a token MUST get a response indistinguishable for "foreign
  // token exists" vs "token does not exist"; a distinct UNAUTHORIZED (401) vs PAIRING_SESSION_NOT_FOUND (404) is a
  // binary token-existence oracle.
  // DECISION: the wrong-owner case is INTENTIONALLY collapsed into the same PAIRING_SESSION_NOT_FOUND (404) as the
  // truly absent case; do not "fix" it back to a distinct 401. Mirrors the uniform-404 masking of
  // SUPPORT_THREAD_NOT_AUTHORIZED in error-mapper.ts and the self-pair NOT_FOUND mask in
  // pairing-session.operations.ts. sessionId is left empty so both paths have identical payloads. (Claimed state
  // does not leak: the owner check precedes it.)
  if (!session || session.stylist_account_id !== stylist_account_id) {
    return failure({
      type: 'PAIRING_SESSION_NOT_FOUND',
      sessionId: '',
    });
  }
  if (session.claimed_by_client_user_id) {
    return failure({
      type: 'PAIRING_CODE_INVALID',
      code: token,
      reason: 'ALREADY_CLAIMED',
    });
  }
  if (session.revoked_at) {
    // Idempotent — already revoked counts as success
    return success({ success: true });
  }

  // Fallback — should not happen, but return generic database error
  return failure({
    type: 'DATABASE_ERROR',
    operation: 'revokePairingSession',
  });
};
