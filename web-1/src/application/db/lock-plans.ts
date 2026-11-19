import type { LockInOrderTarget } from './lock-rows';

/**
 * lock-plans — the lockInOrder target lists of the writers that took a lower-rank row too late
 * (LOCK_GRAPH.md, cycles C1, C2, C4, N2). Pure, so the operations and the real-Postgres family
 * (tests/concurrency/lock-order.concurrency.ts) use the SAME list.
 *
 * DECISION: each `FOR KEY SHARE` target below is the parent the child INSERT's FK check would lock
 * later, out of order. Taking it first, in rank order, is what removes the cycle; deleting one
 * reopens a measured 40P01 (the concurrency family fails).
 */

/**
 * Favorite add: the client's `users` row (FavoriteGalleryRecord.client_user_id) in KEY SHARE, then the
 * record owner's StylistAccount FOR UPDATE (serializes with pairing revoke and like toggles).
 * Cycle C1: session create/share hold users FOR UPDATE and then insert a row referencing the
 * StylistAccount.
 */
export const favoriteAddLockPlan = (
  clientUserId: string,
  ownerAccountId: string
): LockInOrderTarget[] => [
  { table: 'User', id: clientUserId, mode: 'FOR KEY SHARE' },
  { table: 'StylistAccount', id: ownerAccountId, mode: 'FOR UPDATE' },
];

/**
 * Visit write barrier (before lockActivePair): the pair's client `users` row and StylistAccount in
 * KEY SHARE (VisitRecord.client_user_id / stylist_account_id). Cycle C2: pairing revoke holds the
 * StylistAccount FOR UPDATE and then updates the pair.
 */
export const visitWriteLockPlan = (
  clientUserId: string,
  stylistAccountId: string
): LockInOrderTarget[] => [
  { table: 'User', id: clientUserId, mode: 'FOR KEY SHARE' },
  { table: 'StylistAccount', id: stylistAccountId, mode: 'FOR KEY SHARE' },
];

export const salonInvitationAttachLockPlan = (
  userId: string,
  salonAccountId: string
): LockInOrderTarget[] => [
  { table: 'User', id: userId, mode: 'FOR KEY SHARE' },
  { table: 'StylistAccount', id: salonAccountId, mode: 'FOR UPDATE' },
];

/**
 * Onboarding and switch role: the users row first, in the mode its later role UPDATE takes anyway
 * (reconcileActiveRole). Cycle N2: the account write came first and BAN locks users, then the account.
 */
export const roleChangeLockPlan = (userId: string): LockInOrderTarget[] => [
  { table: 'User', id: userId, mode: 'FOR NO KEY UPDATE' },
];

/**
 * Moderation resolve: the owner's users row (BAN only) in NO KEY UPDATE, then the StylistAccount
 * FOR UPDATE that serializes every resolve of this account's reports.
 */
export const moderationResolveLockPlan = (
  accountId: string,
  banOwnerUserId: string | null
): LockInOrderTarget[] => [
  ...(banOwnerUserId !== null
    ? [
        {
          table: 'User' as const,
          id: banOwnerUserId,
          mode: 'FOR NO KEY UPDATE' as const,
        },
      ]
    : []),
  { table: 'StylistAccount', id: accountId, mode: 'FOR UPDATE' },
];
