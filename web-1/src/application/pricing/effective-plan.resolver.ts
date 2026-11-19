import { DB_CLIENT } from '@app/db/db.client';
import type { Prisma } from '../../prisma/js-client';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { resolveEffectivePlan } from '@kernel/domain/pricing/effective-plan';
import { salonDisplayName } from '@kernel/domain/salon-profile/salon-names';

// DECISION: membership grants capabilities, never a subscription or salon ownership. Read on
// each request so leaving or an owner downgrade takes effect immediately, without modifying
// Stripe or the member's own pricing_plan.
export async function resolveEffectivePlan_IO({
  userId,
  ownPlan,
  db = DB_CLIENT.use,
}: {
  userId: string;
  ownPlan: PricingPlan;
  db?: Pick<Prisma.TransactionClient, 'staffMember'>;
}) {
  const plans = await resolveEffectivePlans_IO([{ userId, ownPlan }], db);
  return plans.get(userId) ?? resolveEffectivePlan(ownPlan, []);
}

// One predicate for "this salon grants its plan right now" and "this membership counts", shared by
// the batch resolver and the per-request one below, so the two can never disagree.
const GRANTING_MEMBERSHIP_WHERE = {
  is_active: true,
  accepted_at: { not: null },
} satisfies Prisma.StaffMemberWhereInput;

const grantingSalonWhere = (now: Date) =>
  ({
    subscription_status: 'ACTIVE',
    account_status: 'ACTIVE',
    OR: [
      { account_expiration_date: null },
      { account_expiration_date: { gt: now } },
    ],
    pricing_plan: { in: ['STUDIO', 'SCALE'] },
    created_by_user: { is_active: true, disabled_at: null },
  }) satisfies Prisma.StylistAccountWhereInput;

/**
 * The effective plan of the user authenticating THIS request, in one SQL statement.
 *
 * DECISION: request authentication reads from the granting SALON side (`some` membership of this
 * user) and selects scalars only. The batch resolver's nested `stylist_account` select costs a
 * second round trip, and this read runs on every authenticated stylist request. Same predicate
 * (GRANTING_MEMBERSHIP_WHERE + grantingSalonWhere), same verdict (resolveEffectivePlan), read live
 * from the database every time: no cache, so a leave, removal, owner downgrade or ban is seen by the
 * very next request in every process. Both resolvers order salons by account id, so a tie between
 * two salons of the same tier names the same salon_plan. Parity is proven on real Postgres
 * (tests/postgres/auth-hot-path.test.ts).
 */
export async function resolveRequestEffectivePlan_IO({
  userId,
  ownPlan,
}: {
  userId: string;
  ownPlan: PricingPlan;
}) {
  const salons = await DB_CLIENT.use.stylistAccount.findMany({
    where: {
      ...grantingSalonWhere(new Date()),
      staff_members: {
        some: { user_id: userId, ...GRANTING_MEMBERSHIP_WHERE },
      },
    },
    select: {
      account_id: true,
      business_name: true,
      salon_profile_name: true,
      display_name: true,
      pricing_plan: true,
      subscription_status: true,
    },
    orderBy: { account_id: 'asc' },
    take: 100,
  });
  return resolveEffectivePlan(
    ownPlan,
    salons.map(salon => ({
      // The membership predicate above already required both; the verdict function re-checks them.
      accepted_at: new Date(0),
      is_active: true,
      owner_plan: salon.pricing_plan,
      owner_subscription_status: salon.subscription_status,
      salon_account_id: salon.account_id,
      salon_name: salonDisplayName(salon),
    }))
  );
}

/** Public lists resolve all accounts in one bounded query, without N+1. */
export async function resolveEffectivePlans_IO(
  accounts: readonly { userId: string; ownPlan: PricingPlan }[],
  db: Pick<Prisma.TransactionClient, 'staffMember'> = DB_CLIENT.use
) {
  const plans = new Map<string, ReturnType<typeof resolveEffectivePlan>>();
  if (accounts.length === 0) {
    return plans;
  }
  const rows = await db.staffMember.findMany({
    where: {
      user_id: { in: accounts.map(account => account.userId) },
      ...GRANTING_MEMBERSHIP_WHERE,
      stylist_account: grantingSalonWhere(new Date()),
    },
    select: {
      user_id: true,
      accepted_at: true,
      is_active: true,
      stylist_account: {
        select: {
          account_id: true,
          business_name: true,
          salon_profile_name: true,
          display_name: true,
          pricing_plan: true,
          subscription_status: true,
        },
      },
    },
    // Same tie-break as resolveRequestEffectivePlan_IO (salon account id).
    orderBy: [{ stylist_account_id: 'asc' }, { id: 'asc' }],
    take: Math.min(accounts.length * 100, 10000),
  });
  for (const account of accounts) {
    plans.set(
      account.userId,
      resolveEffectivePlan(
        account.ownPlan,
        rows
          .filter(row => row.user_id === account.userId)
          .map(row => ({
            accepted_at: row.accepted_at,
            is_active: row.is_active,
            owner_plan: row.stylist_account.pricing_plan,
            owner_subscription_status: row.stylist_account.subscription_status,
            salon_account_id: row.stylist_account.account_id,
            salon_name: salonDisplayName(row.stylist_account),
          }))
      )
    );
  }
  return plans;
}
