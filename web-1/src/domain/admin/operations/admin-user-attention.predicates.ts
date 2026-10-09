import { TIME } from '@kernel/application/constants.config';
import {
  ADMIN_ATTENTION,
  type AdminUsersAttentionFilter,
} from '@kernel/domain/admin/admin-attention.config';
import { SubscriptionStatusValue } from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../../prisma/js-client';

/**
 * "Users that need a reaction" as Prisma `where` builders.
 *
 * DECISION (nie usuwaj tego komentarza):
 * ONE definition per badge, used by the admin menu counters
 * (admin-attention.operations.ts) AND by the users list filter `attention`
 * (admin-user-search.operations.ts). The badge links to the list, so both must
 * read the same predicate or the owner opens "Płatności (2)" onto three rows.
 * Thresholds are the kernel's (ADMIN_ATTENTION). `now` is a parameter, so the
 * builders are pure; the count and the list each take their own "now", which
 * can differ by the seconds between the two requests and by nothing else.
 */

/** Subscription states in which money is not coming in and Stripe says why. */
const PAYMENT_PROBLEM_STATUSES = [
  SubscriptionStatusValue.PAST_DUE,
  SubscriptionStatusValue.UNPAID,
  SubscriptionStatusValue.INCOMPLETE,
] as const;

/**
 * Users (not accounts: a user has at most one stylist account) whose
 * subscription has a payment problem, or whose trial ends within
 * TRIAL_ENDING_WITHIN_DAYS days. There is no lower bound on `trial_ends_at`
 * on purpose: a subscription still TRIALING after its trial end is a status
 * that never arrived from Stripe, which needs a look even more.
 */
export const buildPaymentsAttentionWhere = (
  now: Date
): Prisma.UserWhereInput => ({
  stylist_account: {
    OR: [
      { subscription_status: { in: [...PAYMENT_PROBLEM_STATUSES] } },
      {
        subscription_status: SubscriptionStatusValue.TRIALING,
        trial_ends_at: {
          lte: new Date(
            now.getTime() +
              ADMIN_ATTENTION.TRIAL_ENDING_WITHIN_DAYS * TIME.MS_PER_DAY
          ),
        },
      },
    ],
  },
});

/**
 * People who registered and never picked a role (the `onboarding_pending`
 * meaning of the users list: neither a stylist nor a client account), old
 * enough not to be mid-onboarding and young enough to still be worth a
 * message; active and not self-deleted.
 */
export const buildStuckAccountsWhere = (now: Date): Prisma.UserWhereInput => ({
  stylist_account: null,
  client_account: null,
  is_active: true,
  deleted_at: null,
  createdAt: {
    gte: new Date(
      now.getTime() - ADMIN_ATTENTION.STUCK_MAX_AGE_DAYS * TIME.MS_PER_DAY
    ),
    lte: new Date(
      now.getTime() - ADMIN_ATTENTION.STUCK_MIN_AGE_HOURS * TIME.MS_PER_HOUR
    ),
  },
});

const USER_ATTENTION_WHERE = {
  payments: buildPaymentsAttentionWhere,
  stuck: buildStuckAccountsWhere,
} as const satisfies Record<
  AdminUsersAttentionFilter,
  (now: Date) => Prisma.UserWhereInput
>;

export const buildUserAttentionWhere = (
  filter: AdminUsersAttentionFilter,
  now: Date
): Prisma.UserWhereInput => USER_ATTENTION_WHERE[filter](now);
