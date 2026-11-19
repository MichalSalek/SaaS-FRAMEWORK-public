/**
 * Support Thread row-lock helper (concurrency, finding support-1).
 *
 * Single canonical pessimistic lock on a SupportThread row. Every operation that
 * decides on / writes the thread's `status` (user add-message, admin change-status,
 * admin reply reopen) MUST acquire THIS lock at the very start of its $transaction,
 * BEFORE reading status or writing. See DECISION below.
 */

import type { Prisma } from '../../../prisma/js-client';
import { lockSupportThread } from '@app/db/lock-rows';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import {
  assertType,
  isSupportThreadStatusNarrower,
} from '@kernel/models/type_narrowing';

export type LockedSupportThread = {
  id: string;
  user_id: string;
  status: SupportThreadStatus;
  subject: string;
};

// DECISION: PESSIMISTIC row lock (SELECT ... FOR UPDATE) on the SupportThread row. It protects only when
// EVERY writer of the row takes THIS lock: a lock on one side alone serializes nothing (the other side
// reads a stale Read Committed snapshot and its blind UPDATE commits last). So this helper is the common
// first step of the $transaction in addSupportMessage_IO, adminChangeThreadStatus_IO and
// adminReplyToThread_IO: the first to lock proceeds, the rest wait and then read the committed status.
// Not Serializable + retry: a blocking lock is deterministic and simpler for this small, rarely
// concurrent domain (no P2034 loop). SupportThread has no @@map, so the raw SQL uses the PascalCase
// quoted table and column names. Must run INSIDE an active $transaction (the lock lives to its end).
export const lockSupportThreadRow = async (
  tx: Prisma.TransactionClient,
  threadId: string
): Promise<LockedSupportThread | null> => {
  // The SQL lives in @app/db/lock-rows (rank SupportThread = 70; User is taken before it).
  const raw = await lockSupportThread(tx, threadId);
  if (raw === null) {
    return null;
  }

  // DECISION: runtime narrowing of `status`. $queryRaw<LockedSupportThread[]> is only a compile-time cast
  // and Postgres returns a raw string; callers branch on locked.status (CLOSED reject, RESOLVED -> OPEN
  // reopen), so the type guarantee must be real. assertType mutates row.status to the narrowed type, same
  // as the other DB read of this domain; the narrowed copy is returned (support-thread-queries.operations.ts).
  return {
    ...raw,
    status: assertType(
      raw.status,
      isSupportThreadStatusNarrower,
      'SupportThread.status (lock)'
    ),
  };
};
