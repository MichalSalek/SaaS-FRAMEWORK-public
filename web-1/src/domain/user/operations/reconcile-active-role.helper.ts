import type { Prisma } from '../../../prisma/js-client';
import {
  ACCOUNT_TYPE_TO_ROLE_ID,
  SystemRoleId,
} from '@kernel/models/db_models.manual.dto';
import type { AccountType } from '@kernel/domain/user-and-account/role_switch.config';
import { lockInOrder } from '@app/db/lock-rows';
import { roleChangeLockPlan } from '@app/db/lock-plans';

export const reconcileActiveRole = async (
  tx: Prisma.TransactionClient,
  userId: string,
  targetAccountType: AccountType
): Promise<void> => {
  const current = await tx.user.findUnique({
    where: { id: userId },
    select: { role_id: true },
  });

  // UncheckedUpdateInput (nie UpdateInput): role_id to skalarny FK — settable wprost
  // tylko w wariancie Unchecked; UpdateInput wymagalby role: { connect }.
  const data: Prisma.UserUncheckedUpdateInput =
    current?.role_id === SystemRoleId.MASTER_ADMIN
      ? { account_type: targetAccountType }
      : {
          account_type: targetAccountType,
          role_id: ACCOUNT_TYPE_TO_ROLE_ID[targetAccountType],
        };

  await tx.user.update({
    where: { id: userId },
    data,
  });
};

// DECISION: every onboarding / switch-role transaction calls this FIRST. reconcileActiveRole writes the
// users row, and before it these transactions create or update the StylistAccount / ClientAccount. Writing
// the account first and the users row last is the reverse of the canonical order (users -> StylistAccount,
// application/db/LOCK_GRAPH.md) and deadlocked with moderation BAN (users, then StylistAccount). `FOR NO KEY
// UPDATE` is the mode the users UPDATE takes anyway, so this only moves the lock to the front.
export const lockUserForRoleChange = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<void> => {
  await lockInOrder(tx, roleChangeLockPlan(userId));
};
