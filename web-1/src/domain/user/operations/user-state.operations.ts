import { finishSalonInvitationsAfterReactivation } from '@domain/salon-staff/salon-invitation-token.service';
import { finishFreeForSalonOwners_IO } from '@domain/email/operations/free-email.salon-access';
import { DB_CLIENT } from '@app/db/db.client';
import { lockStylistAccountByOwnerUser } from '@app/db/lock-rows';
import { reportIssueBackend } from '@app/debugger/error-handler';
import type { IDType } from '@kernel/application/application.types';
import {
  AccountStatusValue,
  SubscriptionStatusValue,
  type SubscriptionStatus,
} from '@kernel/models/db_models.generated.dto';
import {
  assertType,
  isAccountStatusNarrower,
  isSubscriptionStatusNarrower,
  narrowUser,
} from '@kernel/models/type_narrowing';
import { isP2025 } from '@app/db/prisma-error';
import type { UserWithRelations } from '@kernel/models/user/user.types';
import { USER_POLICY } from '@kernel/policies/user.policy';
import { userRelationsEnabler } from '@domain/user/user.config';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  UserNotFoundError,
  UserHasActiveSubscriptionError,
} from '@kernel/domain/user-and-account/user-errors.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { revokeImpersonationOnEviction } from '@domain/admin/impersonation-eviction';

// DECISION: self-disable is blocked while a subscription is active: the user must cancel in Billing first
// (intent split: "cancel the subscription" vs "disable the account"). Admin disable bypasses (e.g. a
// fraud account must be disabled regardless). Stripe cancellation itself is handled in the delete flow
// (cancelStripeSubscriptionIfExists, user-mutations.operations.ts).
const ACTIVE_SUBSCRIPTION_STATUSES: ReadonlySet<SubscriptionStatus> = new Set([
  SubscriptionStatusValue.ACTIVE,
  SubscriptionStatusValue.TRIALING,
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.INCOMPLETE,
]);

/**
 * User State Operations (enable/disable)
 */

/**
 * Disable user (set is_active = false, account_status = NOT_ACTIVE, delete sessions)
 */
export const disableUser_IO = async (
  passedUser: UserWithRelations
): Promise<
  OperationResult<UserWithRelations | null, UserNotFoundError | DatabaseError>
> => {
  // DECISION: disable is IDEMPOTENT. The update is gated by WHERE disabled_at:null (atomic guard, parity
  // with bulk adminBulkDisable_IO WHERE is_active:true) inside a $transaction to avoid a TOCTOU between
  // read and updateMany. When the user is ALREADY disabled, count === 0: disabled_at (the first ban's
  // timestamp) is not overwritten and an idempotent success with fresh state is returned. updateMany(count)
  // rather than update(throws) because P2025 cannot tell "already disabled" from "does not exist".
  // disabled_at is the idempotency SSOT: a duplicate USER_DISABLED audit event (emitted in
  // adminDisableUserAny_IO on .success) plus an overwritten timestamp is a defect.
  let userRaw: Awaited<ReturnType<typeof DB_CLIENT.use.user.update>> | null =
    null;
  let stateChanged = false;
  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      const updated = await tx.user.updateMany({
        where: { id: passedUser.id, disabled_at: null },
        data: { is_active: false, disabled_at: new Date() },
      });

      stateChanged = updated.count > 0;

      // Bramkujemy nastepstwa (cascade account_status + session evict) na faktycznej
      // zmianie stanu: no-op re-disable nie kasuje sesji ani nie dotyka konta.
      if (stateChanged && passedUser.stylist_account) {
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: passedUser.id },
          data: {
            account_status: assertType(
              AccountStatusValue.NOT_ACTIVE,
              isAccountStatusNarrower,
              'NOT_ACTIVE status'
            ),
          },
        });
      }
      if (stateChanged) {
        await tx.session.deleteMany({ where: { userId: passedUser.id } });
      }

      return await tx.user.findUnique({
        where: { id: passedUser.id },
        include: userRelationsEnabler,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
    }
    return databaseFailure('disableUser_IO', error);
  }

  // findUnique miss = wiersz nie istnieje => USER_NOT_FOUND (zachowuje semantyke
  // sciezki P2025 sprzed refaktoru; nie ma to zwiazku z idempotentnym no-opem,
  // ktory zwraca istniejacy wiersz).
  if (!userRaw) {
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }

  const narrowed = narrowUser<UserWithRelations>(userRaw, 'disableUser_IO');
  if (!narrowed) {
    reportIssueBackend({
      namespace: 'disableUser_IO',
      message: 'narrowUser returned null after successful update',
      payload: { id: passedUser.id },
      mode: 'error',
    });
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }
  // Eviction cleanup: a disabled mid-impersonation admin's own sessions are deleted
  // above, but the orphaned impersonated (target) session escapes — revoke it +
  // the backup (connected-dots of impersonation-l2-7). Tylko gdy faktycznie
  // wylaczylismy konto w tym wywolaniu (no-op re-disable nie evictuje).
  if (stateChanged) {
    await revokeImpersonationOnEviction(passedUser.id);
  }
  // stateChanged===false = idempotentny no-op (re-disable juz-wylaczonego LUB przegrany
  // CAS pod wspolbieznoscia: dwa USER_DISABLE_ANY na ten sam target). success(null) =>
  // caller (adminDisableUserAny_IO) pomija emit audit-eventu USER_DISABLED — parytet z
  // disableSelfUser_IO, ktory tez zwraca success(null) na przegrany CAS. Winner
  // (stateChanged===true) zwraca swiezy wiersz. To zamyka defekt duplikatu audit-eventu
  // opisany w DECISION nad funkcja: pre-read gate w callerze (getUser_IO PRZED CAS) widzial
  // disabled_at===null w OBU rownoleglych wywolaniach i emitowal audit 2x mimo jednego
  // realnego flipu. Rozroznienie null-no-op od USER_NOT_FOUND: not-found idzie failure()
  // wyzej (userRaw/narrowed null); tutaj narrowed to zawsze wazny wiersz.
  return success(stateChanged ? narrowed : null);
};

/**
 * Enable user (set is_active = true, conditionally activate account)
 */
export const enableUser_IO = async (
  passedUser: UserWithRelations
): Promise<
  OperationResult<UserWithRelations | null, UserNotFoundError | DatabaseError>
> => {
  // DECISION: enable is idempotent: a fresh row is read in a $transaction and branched:
  //  (a) no row -> USER_NOT_FOUND
  //  (b) deleted_at != null -> USER_NOT_FOUND: a soft-deleted account is revived only through
  //      reactivateAccount_IO (deleted_at is the retention SSOT, DOMAIN_SSOT §13.1); IDOR mask
  //  (c) already enabled -> no-op, stateChanged=false => success(null), so no duplicate USER_ENABLED
  //  (d) admin-disabled -> flip is_active + cascade as a compare-and-set (WHERE NOT(disabled_at:null
  //      AND is_active:true)); count 0 under a lost race => success(null)
  // The read-then-branch precedes the CAS because a soft-deleted row has disabled_at==null and must
  // exit through (b). payment_status for the account_status gate comes from the fresh row.
  let userRaw: Awaited<ReturnType<typeof DB_CLIENT.use.user.update>> | null =
    null;
  let stateChanged = false;
  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      const freshRaw = await tx.user.findUnique({
        where: { id: passedUser.id },
        include: userRelationsEnabler,
      });
      const fresh = freshRaw
        ? narrowUser<UserWithRelations>(freshRaw, 'enableUser_IO:fresh')
        : null;

      // (a) missing / (b) soft-deleted — both surface as USER_NOT_FOUND.
      if (!fresh || fresh.deleted_at !== null) {
        return null;
      }

      // (c) already enabled — idempotent no-op, return current row untouched.
      // stateChanged stays false => the caller (adminEnableUserAny_IO) skips the USER_ENABLED audit.
      // Returns the existing row (NOT null: null is reserved for USER_NOT_FOUND in the post-tx branch).
      if (fresh.disabled_at === null && fresh.is_active) {
        return freshRaw;
      }

      // (d) admin-disabled -> re-enable jako COMPARE-AND-SET (parytet z disableUser_IO
      // WHERE disabled_at:null). WHERE NOT(disabled_at:null AND is_active:true) = dokladna
      // negacja bramki (c): matchuje admin-disabled ORAZ zachowany repair stanu
      // (is_active=false / disabled_at=null), a NIE matchuje juz-wlaczonego. Pod
      // wspolbieznoscia (dwa USER_ENABLE_ANY na ten sam target) tylko JEDEN tx flipuje
      // (count 1); przegrany wyscig (rownolegly enable scommitowal flip pierwszy) dostaje
      // count 0 => stateChanged=false => success(null) => caller pomija duplikat
      // audit-eventu USER_ENABLED. deleted_at:null = belt-and-suspenders ((b) juz odsial
      // soft-deleted).
      const flip = await tx.user.updateMany({
        where: {
          id: fresh.id,
          deleted_at: null,
          NOT: { disabled_at: null, is_active: true },
        },
        data: {
          is_active: true,
          disabled_at: null,
          deleted_at: null,
          recovery_available: false,
        },
      });
      stateChanged = flip.count > 0;

      // Cascade account_status TYLKO na faktycznym flipie (no-op / przegrany CAS nie
      // re-cascade'uje — parytet z disableUser_IO stateChanged-gate; concurrent winner
      // juz scascade'owal).
      if (
        stateChanged &&
        fresh.stylist_account &&
        USER_POLICY.utils.CAN_USER_HAVE_ACTIVE_ACCOUNT({ user: fresh })
      ) {
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: fresh.id },
          data: {
            account_status: assertType(
              AccountStatusValue.ACTIVE,
              isAccountStatusNarrower,
              'ACTIVE status'
            ),
          },
        });
      }

      if (
        stateChanged &&
        fresh.stylist_account &&
        (fresh.stylist_account.pricing_plan === 'STUDIO' ||
          fresh.stylist_account.pricing_plan === 'SCALE') &&
        fresh.stylist_account.subscription_status === 'ACTIVE'
      ) {
        await finishFreeForSalonOwners_IO(tx, [fresh.id]);
      }

      return await tx.user.findUnique({
        where: { id: fresh.id },
        include: userRelationsEnabler,
      });
    });
  } catch (error: unknown) {
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
    }
    return databaseFailure('enableUser_IO', error);
  }

  if (!userRaw) {
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }

  const narrowed = narrowUser<UserWithRelations>(userRaw, 'enableUser_IO');
  if (!narrowed) {
    reportIssueBackend({
      namespace: 'enableUser_IO',
      message: 'narrowUser returned null after successful update',
      payload: { id: passedUser.id },
      mode: 'error',
    });
    return failure({ type: 'USER_NOT_FOUND', userId: passedUser.id });
  }
  // stateChanged===false = idempotentny no-op (branch (c) juz-wlaczony LUB przegrany CAS
  // branch (d)). success(null) => caller pomija duplikat audit-eventu USER_ENABLED
  // (parytet z disableUser_IO). Winner zwraca swiezy wiersz.
  if (stateChanged) {
    // DECISION: see salon-invitation-token.service.ts (an active account again finishes both sides).
    await finishSalonInvitationsAfterReactivation(narrowed.id, 'admin enable');
  }
  return success(stateChanged ? narrowed : null);
};

/**
 * Sentinel thrown inside the disable $transaction to carry the active-subscription
 * status payload out to the catch site without an unsafe magic property on a bare
 * Error. `instanceof` at the catch site gives a fully-typed `subscriptionStatus`.
 */
class ActiveSubscriptionError extends Error {
  constructor(readonly subscriptionStatus: string) {
    super('__USER_HAS_ACTIVE_SUBSCRIPTION__');
  }
}

/**
 * Disable self user (user disables their own account)
 */
export const disableSelfUser_IO = async ({
  id,
}: {
  id: IDType;
}): Promise<
  OperationResult<
    UserWithRelations | null,
    UserNotFoundError | UserHasActiveSubscriptionError | DatabaseError
  >
> => {
  let userRaw: UserWithRelations | null;

  try {
    userRaw = await DB_CLIENT.use.$transaction(async tx => {
      const freshRaw = await tx.user.findUnique({
        where: { id },
        include: userRelationsEnabler,
      });

      if (!freshRaw) {
        throw new Error('__USER_NOT_FOUND__');
      }

      const fresh = narrowUser<UserWithRelations>(
        freshRaw,
        'disableSelfUser_IO'
      );
      if (!fresh) {
        throw new Error('__USER_NOT_FOUND__');
      }

      // (1) already-disabled short-circuit: MUST come BEFORE the CAS and the active-sub gate
      // (see the canonical gate order DECISION above the function). Idempotentny no-op: NIE
      // nadpisujemy disabled_at (znacznik pierwszego self-disable zostaje), NIE sprawdzamy
      // subskrypcji, NIE evictujemy. success(null) => caller pomija audit-event. Kontrakt
      // "re-self-disable na wylaczonym koncie = idempotentny no-op" — NIE wolno go zlamac
      // false-positivem USER_HAS_ACTIVE_SUBSCRIPTION na stale/aktywnym subscription_status
      // juz-wylaczonego wiersza (user nie ma juz sesji, by anulowac sub; regresja r1b).
      if (fresh.disabled_at !== null) {
        return null;
      }

      // (2) CAS-claim: only a row NOT YET disabled passes (parity with softDeleteAccount_IO /
      // reactivateAccount_IO). It takes the row lock on User, NEEDED BEFORE the StylistAccount
      // lock below (order User→StylistAccount, see the LOCK ORDER DECISION above the function).
      // count===0 => przegrany wyscig (rownolegly self-disable wygral CAS
      // miedzy naszym fresh-read a tym updateMany) => idempotentny no-op.
      const claim = await tx.user.updateMany({
        where: { id: fresh.id, disabled_at: null },
        data: { is_active: false, disabled_at: new Date() },
      });

      if (claim.count === 0) {
        return null;
      }

      // (3) Active-sub gate UNDER the owning StylistAccount row lock (lockStylistAccountByOwnerUser,
      // @app/db/lock-rows): re-read subscription_status under the lock so the gate serializes with the
      // Stripe webhook's write to the same row. Taken AFTER the CAS on User, so the order is
      // User -> StylistAccount. A client (no stylist_account) has no subscription, so no gate. Active
      // sub => throw => ROLLBACK undoes the CAS (user NOT disabled).
      if (fresh.stylist_account) {
        const locked = await lockStylistAccountByOwnerUser(tx, fresh.id);
        const lockedStatus = locked?.subscription_status ?? null;
        if (
          lockedStatus !== null &&
          isSubscriptionStatusNarrower(lockedStatus) &&
          ACTIVE_SUBSCRIPTION_STATUSES.has(lockedStatus)
        ) {
          throw new ActiveSubscriptionError(lockedStatus);
        }

        // (4) Winner bez active sub — cascade account_status (lock StylistAccount juz trzymany
        // wyzej; updateMany nie wspiera nested relation writes, stad osobny call).
        await tx.stylistAccount.updateMany({
          where: { created_by_user_id: fresh.id },
          data: {
            account_status: assertType(
              AccountStatusValue.NOT_ACTIVE,
              isAccountStatusNarrower,
              'NOT_ACTIVE status'
            ),
          },
        });
      }
      await tx.session.deleteMany({ where: { userId: fresh.id } });

      const updated = await tx.user.findUnique({
        where: { id: fresh.id },
        include: userRelationsEnabler,
      });
      return updated
        ? narrowUser<UserWithRelations>(updated, 'disableSelfUser_IO:fresh')
        : null;
    });
  } catch (error: unknown) {
    if (error instanceof ActiveSubscriptionError) {
      return failure({
        type: 'USER_HAS_ACTIVE_SUBSCRIPTION',
        userId: id,
        subscriptionStatus: error.subscriptionStatus,
      });
    }
    if (error instanceof Error) {
      if (error.message === '__USER_NOT_FOUND__') {
        return failure({ type: 'USER_NOT_FOUND', userId: id });
      }
    }
    if (isP2025(error)) {
      return failure({ type: 'USER_NOT_FOUND', userId: id });
    }
    return databaseFailure('disableSelfUser_IO', error);
  }

  // success(null) = idempotent no-op (already disabled / lost the CAS race). Caller MUST
  // treat null as "nothing newly disabled" and skip the duplicate audit event.
  return success(userRaw);
};
