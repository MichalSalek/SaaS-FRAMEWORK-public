import { DB_CLIENT } from '@app/db/db.client';

/**
 * Cleanup expired pairing tokens. Preserves claimed/revoked sessions —
 * they are FK-referenced by ClientStylistPair.paired_via_pairing_session_id
 * and serve as audit trail for established pairings.
 *
 * Cron-op (sweep) convention: `_IO` suffix + explicit typed return, mirroring
 * sweepExpiringAndExpiredAccounts_IO. It does NOT return OperationResult (a
 * fire-and-forget sweep has no domain-error envelope to surface), so it is not
 * caught by the operation-io-suffix ratchet — the suffix here is convention
 * parity for the IO-boundary, not the ratchet's OperationResult rule.
 */
export const cleanupExpiredTokens_IO = async (): Promise<{
  deleted: number;
}> => {
  const result = await DB_CLIENT.use.pairingSession.deleteMany({
    where: {
      expires_at: { lt: new Date() },
      claimed_by_client_user_id: null,
      revoked_at: null,
    },
  });

  return { deleted: result.count };
};
