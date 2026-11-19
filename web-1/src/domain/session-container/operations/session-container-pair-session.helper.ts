// One open session per client and stylist (partial-unique
// `session_container_active_pair_uq`; a DRAFT counts). Used by add-photo when
// the first photo of a stylist-less session would lock in its stylist.

import { DB_CLIENT } from '@app/db/db.client';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../../prisma/js-client';

type PairSessionQuery = {
  client_account_id: string;
  stylist_account_id: string;
  /** The session being filled: never its own collision. */
  session_id: string;
};

const otherOpenPairSessionWhere = ({
  client_account_id,
  stylist_account_id,
  session_id,
}: PairSessionQuery) => ({
  client_account_id,
  stylist_account_id,
  id: { not: session_id },
  lifecycle_state: {
    notIn: [
      SessionContainerLifecycleStateValue.CLOSED,
      SessionContainerLifecycleStateValue.EXPIRED,
    ],
  },
});

/**
 * Sentinel thrown inside the add-photo $transaction when the pair already has
 * ANOTHER open session. Read before the write, so the refusal carries the open
 * session's id instead of surfacing as a bare index collision.
 */
export class PairSessionExistsInTxError extends Error {
  constructor(
    readonly stylistAccountId: string,
    readonly existingSessionId: string
  ) {
    super('__PAIR_SESSION_EXISTS_IN_TX__');
  }
}

export const assertNoOtherOpenPairSession = async (
  tx: Prisma.TransactionClient,
  query: PairSessionQuery
): Promise<void> => {
  const open = await tx.sessionContainer.findFirst({
    where: otherOpenPairSessionWhere(query),
    select: { id: true },
  });
  if (open) {
    throw new PairSessionExistsInTxError(query.stylist_account_id, open.id);
  }
};

// Best-effort read-back of the session that won the pair index after a P2002:
// the refusal stands without it (null), so a failed read never becomes a 500.
export const findOtherOpenPairSessionId = async (
  query: PairSessionQuery
): Promise<string | null> => {
  try {
    const open = await DB_CLIENT.use.sessionContainer.findFirst({
      where: otherOpenPairSessionWhere(query),
      select: { id: true },
    });
    return open?.id ?? null;
  } catch {
    return null;
  }
};
