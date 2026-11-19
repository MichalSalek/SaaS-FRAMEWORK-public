import { finishFreeForSalonOwners_IO } from '@domain/email/operations/free-email.salon-access';
/**
 * Bulk StylistAccount.account_status cascade. updateMany cannot use the
 * single-user nested update, so these helpers apply the same status change
 * to a set of user ids.
 * DECISION: both take `tx` and run inside the same `$transaction` as
 * user.updateMany (and session.deleteMany on disable). A partial failure left
 * is_active=false with account_status=ACTIVE, so a disabled account stayed public.
 */

import type { Prisma } from '../../../prisma/js-client';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

/**
 * Cascade for bulk DISABLE — mirror disableUser_IO (user-state.operations.ts):
 * disabling a user unconditionally sets the owning stylist account to
 * NOT_ACTIVE so the public profile + directory + sitemap go offline.
 *
 * Unconditional (no payment_status gate) — parity with single disable, which
 * sets NOT_ACTIVE regardless of payment state. Takes down public visibility for
 * fraud/abuse/spam at scale.
 */
export const cascadeBulkDisableAccountStatus = async (
  tx: Prisma.TransactionClient,
  nonAdminIds: string[]
): Promise<void> => {
  if (nonAdminIds.length === 0) {
    return;
  }
  await tx.stylistAccount.updateMany({
    where: { created_by_user_id: { in: nonAdminIds } },
    data: { account_status: AccountStatusValue.NOT_ACTIVE },
  });
};

export const cascadeBulkEnableAccountStatus = async (
  tx: Prisma.TransactionClient,
  nonAdminIds: string[]
): Promise<void> => {
  if (nonAdminIds.length === 0) {
    return;
  }
  await tx.stylistAccount.updateMany({
    where: {
      created_by_user_id: { in: nonAdminIds },
      created_by_user: { is_active: true, deleted_at: null },
      OR: [
        { payment_status: PaymentStatusValue.PAID },
        {
          pricing_plan: PricingPlanValue.FREE,
          plan_selected_at: { not: null },
        },
      ],
    },
    data: { account_status: AccountStatusValue.ACTIVE },
  });
  await finishFreeForSalonOwners_IO(tx, nonAdminIds);
};
