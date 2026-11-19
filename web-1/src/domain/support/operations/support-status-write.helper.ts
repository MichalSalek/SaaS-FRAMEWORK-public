/**
 * Support thread status-write helper (optimistic concurrency, finding support-1).
 *
 * Applies an admin status change to a SupportThread that is ALREADY pessimistically
 * locked (lockSupportThreadRow / FOR UPDATE) by the caller, inside the SAME $transaction.
 * Encapsulates the USER-FIRST optimistic-concurrency guard so the operation stays lean.
 */

import type { Prisma } from '../../../prisma/js-client';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import { SupportSenderTypeValue } from '@kernel/models/support/support.dto';

// Shape is intentionally a subset of the caller's $transaction result union
// ({ ok:true } | { ok:false; reason:'NOT_FOUND' } | { ok:false; reason:'STALE' }) so the
// operation can return it directly — NOT_FOUND is decided by the caller before this runs.
//
// DECISION: `noop?: true` on the success branch means target status == current status, so the helper
// skipped the write. It is optional and only on `ok:true`, so `{ ok:true; noop?:true }` stays assignable
// to the narrower `{ ok:true }` of the caller's $transaction generic; callers compile unchanged and ignore
// the flag until they read it.
export type SupportStatusWriteResult =
  { ok: true; noop?: true } | { ok: false; reason: 'STALE' };

export const applySupportStatusWrite = async (
  tx: Prisma.TransactionClient,
  threadId: string,
  status: SupportThreadStatus,
  expectedUpdatedAt: string | Date | null | undefined
): Promise<SupportStatusWriteResult> => {
  // null and undefined both mean unconditional (see DECISION above); `== null` catches both.
  if (expectedUpdatedAt == null) {
    // Skip the write when the target status is already current. The row is already
    // FOR UPDATE locked by the caller in this transaction, so this select takes no new lock.
    const current = await tx.supportThread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (current !== null && current.status === status) {
      return { ok: true, noop: true };
    }

    await tx.supportThread.update({
      where: { id: threadId },
      data: { status },
    });
    return { ok: true };
  }

  const expected = new Date(expectedUpdatedAt);

  // Signal 1: same-ms USER messages vs the updated_at-owner baseline (see DECISION above).
  const userMessagesAtSameMs = await tx.supportMessage.count({
    where: {
      thread_id: threadId,
      sender_type: SupportSenderTypeValue.USER,
      // Same-ms only (== expected), never `gte`.
      created_at: { equals: expected },
    },
  });

  const baseline = userMessagesAtSameMs >= 1 ? 1 : 0;

  if (userMessagesAtSameMs > baseline) {
    return { ok: false, reason: 'STALE' };
  }

  // The skip follows both staleness signals. A matching status is a no-op only when the
  // snapshot is fresh, using the same updated_at predicate as the write. Otherwise CLOSED
  // to CLOSED on a concurrently bumped thread would hide the conflict. A matching
  // (id, updated_at) row skips; no match is stale.
  const fresh = await tx.supportThread.findFirst({
    where: { id: threadId, updated_at: expected },
    select: { status: true },
  });

  if (fresh === null) {
    return { ok: false, reason: 'STALE' };
  }

  if (fresh.status === status) {
    return { ok: true, noop: true };
  }

  const updated = await tx.supportThread.updateMany({
    where: { id: threadId, updated_at: expected },
    data: { status },
  });

  if (updated.count === 0) {
    return { ok: false, reason: 'STALE' };
  }

  return { ok: true };
};
