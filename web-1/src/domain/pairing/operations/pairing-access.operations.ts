import type { PairingSessionNotFoundError } from '@kernel/domain/pairing/pairing-errors.types';
import { resolveSalonAccess_IO } from '../salon-access.resolver';
import { reconcileSalonDerivedPairingsAfterCommit_IO } from '../salon-derived-cleanup.operations';
import { revokePairingAccessCore_IO } from './pairing-revoke-core.operations';
import { DB_CLIENT } from '@app/db/db.client';
import {
  AccountStatusValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';
import {
  type OperationResult,
  success,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

export const revokePairingAccess_IO = async (
  params: Parameters<typeof revokePairingAccessCore_IO>[0]
): Promise<
  OperationResult<
    { success: true },
    DatabaseError | PairingSessionNotFoundError
  >
> => {
  const revoked = await revokePairingAccessCore_IO(params);
  if (!revoked.success) {
    return revoked;
  }
  if (revoked.data.revokedDirectClientUserId) {
    await reconcileSalonDerivedPairingsAfterCommit_IO(
      { clientUserId: revoked.data.revokedDirectClientUserId },
      'revokePairingAccess'
    );
  }
  return success({ success: true });
};

/**
 * Get access status (PUBLIC vs PAIRED)
 */
export const getAccessStatus_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id?: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    | { access: 'PUBLIC' }
    | { access: 'PAIRED'; paired_at: Date; pair_id: string }
    | { access: 'PENDING'; pair_id: string },
    DatabaseError
  >
> => {
  // DECISION: the `!client_user_id -> PUBLIC` branch is deliberately defensive though unreachable for the only
  // current caller (get-access-status, CLIENT_SPECIFIC RBAC: the auth gate returns 401 without a session and RBAC
  // 403 for a non-CLIENT, so client_user_id is always present). It stays for parity with anonymously reachable
  // read endpoints (public-profile) and as a safe default if the op is reused on a public surface. Do NOT remove
  // it as dead code or make `client_user_id` required.
  if (!client_user_id) {
    return success({ access: 'PUBLIC' as const });
  }

  let pair;
  try {
    // DECISION: PAIRED is reported only while the stylist is still active (StylistAccount.account_status ===
    // ACTIVE). The pair status (ACTIVE) alone is not enough: admin disable/ban cascades account_status=NOT_ACTIVE
    // (admin-bulk.operations.ts) and the protected resource (the gallery) is gated on account_status
    // (gallery-paired-client), so without this a client would see PAIRED to a taken-down stylist. The pair STAYS
    // in the DB and returns as PUBLIC; after re-enable it is PAIRED again (the flip is reversible).
    // One read distinguishes ACTIVE and PENDING (the permanent QR): the client profile shows "request waiting"
    // instead of a second button. PENDING is subject to the same stylist visibility filter as PAIRED.
    pair = await DB_CLIENT.use.clientStylistPair.findFirst({
      where: {
        client_user_id,
        stylist_account_id,
        status: {
          in: [PairingStatusValue.ACTIVE, PairingStatusValue.PENDING],
        },
        stylist_account: { account_status: AccountStatusValue.ACTIVE },
      },
      select: {
        id: true,
        paired_at: true,
        status: true,
        salon_origin_account_id: true,
      },
    });
  } catch (error) {
    return databaseFailure('getAccessStatus', error);
  }

  if (pair?.salon_origin_account_id) {
    try {
      if (!(await resolveSalonAccess_IO(client_user_id, stylist_account_id))) {
        return success({ access: 'PUBLIC' as const });
      }
    } catch (error) {
      return databaseFailure('getAccessStatus', error);
    }
  }

  if (!pair) {
    return success({ access: 'PUBLIC' as const });
  }

  if (pair.status === PairingStatusValue.PENDING) {
    return success({ access: 'PENDING' as const, pair_id: pair.id });
  }

  return success({
    access: 'PAIRED' as const,
    paired_at: pair.paired_at,
    pair_id: pair.id,
  });
};
