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
  // DECISION (nie usuwaj tego komentarza):
  // Race-safe revoke uses atomic updateMany with composite WHERE clause:
  //   - token match
  //   - owner stylist match (authorization)
  //   - claimed_by_client_user_id IS NULL (not yet claimed)
  //   - revoked_at IS NULL (not yet revoked)
  // If updateMany.count === 0, we run a follow-up SELECT to determine WHY
  // (not found / wrong owner / already claimed). Wrong-owner is deliberately
  // collapsed into the not-found response (anti-enumeration — see the SECURITY
  // note at the classification branch below). This eliminates the TOCTOU race
  // between check-then-update.
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

  // SECURITY (anti-enumeration): a non-owner probing a token MUST get a response
  // byte-for-byte indistinguishable for "foreign token exists" vs "token does not
  // exist". A distinct UNAUTHORIZED (->401) for wrong-owner vs PAIRING_SESSION_NOT_FOUND
  // (->404) for not-found is a binary token-existence oracle: a non-owner could probe
  // whether any arbitrary token belongs to another stylist. A non-owner has no
  // legitimate need to learn that a foreign token exists.
  // DECISION (nie usuwaj tego komentarza): the wrong-owner case is INTENTIONALLY
  // collapsed into the same PAIRING_SESSION_NOT_FOUND ("not found", ->404) as the
  // truly-absent case — do not "fix" it back to a distinct 401/UNAUTHORIZED. Mirrors
  // the SUPPORT_THREAD_NOT_AUTHORIZED uniform-404 masking in error-mapper.ts and the
  // self-pair NOT_FOUND mask in pairing-session.operations.ts (claim flow). sessionId
  // is left empty so the owner-vs-nonexistent paths are identical payloads.
  // (Claimed-state already does not leak: the owner-check precedes it, so claimed-vs-
  // unclaimed of a FOREIGN token is never reachable here.)
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
