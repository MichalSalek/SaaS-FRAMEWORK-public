/**
 * Admin Bulk — StylistAccount.account_status cascade helpers
 *
 * Single-user disable/enable (user-state.operations.ts) cascade
 * StylistAccount.account_status alongside User.is_active. The bulk ops mutate
 * many User rows via updateMany, so they cannot reuse the single-user nested
 * `user.update({ stylist_account: { update } })` shape. These helpers replicate
 * the exact same cascade semantics over a set of user ids via
 * stylistAccount.updateMany.
 *
 * RULE OF THREE (disable / enable / soft-delete duplicated the account_status
 * cascade): centralising the bulk side here keeps single-op and bulk-op
 * visibility in lockstep so they never diverge again (see QA findings
 * admin-user-mgmt-1 / -3 — "disabled but publicly visible" / "enabled but
 * invisible").
 *
 * DECISION (nie usuwaj tego komentarza) — DV1: oba helpery przyjmują `tx`
 * (Prisma.TransactionClient) i MUSZĄ być wołane WEWNĄTRZ aktywnej interaktywnej
 * `$transaction`. Bulk disable/enable wykonują wiele zależnych writes
 * (user.updateMany → ten account_status cascade → session.deleteMany dla
 * disable). Partial-failure między statementami zostawiał niespójny stan:
 * user.is_active=false ale account_status=ACTIVE → "wyłączony ale publicznie
 * widoczny" (profil/directory/sitemap online dla zdezaktywowanego konta — leak,
 * który ten cascade miał naprawić). Atomowość całej grupy writes przez tx
 * gwarantuje all-or-nothing. Parytet z single-op disableUser_IO/enableUser_IO,
 * które są atomic przez nested `user.update`.
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

/**
 * Cascade for bulk ENABLE — mirror enableUser_IO (user-state.operations.ts):
 * re-enabling a user restores account_status=ACTIVE ONLY when the account is
 * eligible (payment_status=PAID, i.e. USER_POLICY.CAN_USER_HAVE_ACTIVE_ACCOUNT).
 *
 * The policy gate is expressed here as WHERE filters because updateMany cannot
 * run the per-row predicate the single-op uses:
 *  - eligibility = CAN_USER_HAVE_ACTIVE_ACCOUNT replicated as OR: payment_status=PAID
 *    OR onboarded Free (pricing_plan=FREE AND plan_selected_at≠null). MUST stay in
 *    lockstep with the policy (user.policy.ts) — a Free stylist is legitimately ACTIVE
 *    despite UNPAID, so a PAID-only filter would strand them at is_active=true +
 *    NOT_ACTIVE after a bulk enable. Ineligible accounts keep their current
 *    (NOT_ACTIVE) status, exactly like enableUser_IO when the policy returns false.
 *  - created_by_user.is_active=true AND deleted_at=null — MUST be checked because
 *    this cascade runs AFTER the bulk user.updateMany which deliberately skips
 *    soft-deleted rows. Without this guard a soft-deleted (GDPR-pending) PAID
 *    account in the same batch would get account_status=ACTIVE while is_active
 *    stays false → its public profile would be re-exposed (public gates check
 *    account_status). The relation filter scopes the cascade to the accounts that
 *    were actually re-enabled in this same call.
 */
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
};
