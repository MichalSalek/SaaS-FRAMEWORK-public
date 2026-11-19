import { DB_CLIENT } from '@app/db/db.client';
import {
  type OperationResult,
  success,
} from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';

// DECISION: revokeAllPairingSessions invalidates ONLY outstanding unclaimed QR tokens
// (claimed_by_client_user_id: null), a token-spam cleanup. It does NOT disconnect established ClientStylistPair
// rows (per-client revokePairingAccess does, DOMAIN_SSOT §5.4). revoked_count counts tokens, not pairs.
export const revokeAllPairingSessions_IO = async ({
  stylist_account_id,
}: {
  stylist_account_id: string;
}): Promise<OperationResult<{ revoked_count: number }, DatabaseError>> => {
  try {
    const { count } = await DB_CLIENT.use.pairingSession.updateMany({
      where: {
        stylist_account_id,
        revoked_at: null,
        claimed_by_client_user_id: null,
      },
      data: { revoked_at: new Date() },
    });

    return success({ revoked_count: count });
  } catch (error) {
    return databaseFailure('revokeAllPairingSessions', error);
  }
};
