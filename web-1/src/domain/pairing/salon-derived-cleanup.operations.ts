import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { resolveSalonAccess_IO } from './salon-access.resolver';
import { revokePairingAccessCore_IO } from './operations/pairing-revoke-core.operations';

// DECISION: expired salon-derived contacts follow ordinary disconnect semantics, including preserved CRM
// notes/visits and closed live sessions. Direct contacts are never touched. Reads deny expired access immediately;
// reconciliation is bounded and idempotent, so a missed lifecycle hook cannot expose stale works.
export async function reconcileSalonDerivedPairings_IO(scope: {
  salonAccountId?: string;
  clientUserId?: string;
  stylistAccountId?: string;
}): Promise<void> {
  let cursor: string | undefined;
  for (;;) {
    const pairs = await DB_CLIENT.use.clientStylistPair.findMany({
      where: {
        status: 'ACTIVE',
        salon_origin_account_id: scope.salonAccountId ?? { not: null },
        ...(scope.clientUserId ? { client_user_id: scope.clientUserId } : {}),
        ...(scope.stylistAccountId
          ? { stylist_account_id: scope.stylistAccountId }
          : {}),
      },
      select: { id: true, client_user_id: true, stylist_account_id: true },
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
      take: 100,
      orderBy: { id: 'asc' },
    });
    for (const pair of pairs) {
      if (
        !(await resolveSalonAccess_IO(
          pair.client_user_id,
          pair.stylist_account_id
        ))
      ) {
        const revoked = await revokePairingAccessCore_IO({
          current_user_id: pair.client_user_id,
          target_account_id: pair.stylist_account_id,
        });
        if (!revoked.success) {
          throw new Error('Salon-derived pairing reconciliation failed');
        }
      }
    }
    if (pairs.length < 100) {
      break;
    }
    cursor = pairs[pairs.length - 1]?.id;
  }
}

type ReconcileScope = Parameters<typeof reconcileSalonDerivedPairings_IO>[0];

/**
 * Reconciliation run AFTER a membership or pairing change has committed.
 *
 * DECISION: four user actions (leave a team, remove a member, hide one's works from salons, disconnect a client)
 * used to await this cleanup after their own transaction and turn its failure into the action's failure, so the
 * person saw "nie udało się" for a change that WAS saved, and a retry did nothing new. The cleanup is not part of
 * the action: reads deny expired salon access immediately and the next run repeats it idempotently, so a failure
 * here is reported, not returned.
 */
export async function reconcileSalonDerivedPairingsAfterCommit_IO(
  scope: ReconcileScope,
  origin: string
): Promise<void> {
  try {
    await reconcileSalonDerivedPairings_IO(scope);
  } catch (error) {
    reportIssueBackend({
      namespace: 'salon-derived-reconcile',
      message: `Salon-derived pairing cleanup failed after ${origin}`,
      payload: {
        ...scope,
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
  }
}
