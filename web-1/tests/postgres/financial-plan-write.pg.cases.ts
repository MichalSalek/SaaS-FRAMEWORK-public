import { randomUUID } from 'node:crypto';
import { expect, it } from 'vitest';
import type { PrismaClient } from '../../src/prisma/js-client';
import { updateAccountPlanStatus } from '@app/stripe/plan-status-update.operations';
import type { Pool } from 'pg';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  PaymentStatusValue,
  AccountStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';

export async function createPlanWriteEnums(pool: Pool): Promise<void> {
  for (const [name, values] of Object.entries({
    PricingPlan: Object.values(PricingPlanValue),
    PaymentStatus: Object.values(PaymentStatusValue),
    AccountStatus: Object.values(AccountStatusValue),
    SubscriptionStatus: Object.values(SubscriptionStatusValue),
  })) {
    await pool.query(
      `CREATE TYPE "${name}" AS ENUM (${values.map(value => `'${value}'`).join(', ')})`
    );
  }
}

/** Uses the financial suite's isolated schema and actual Prisma mutation. */
export function registerInvoicePlanWriteCases(client: () => PrismaClient) {
  it('rejects a late invoice write after replacement and applies a matching invoice', async () => {
    const accountId = randomUUID();
    await client().$executeRaw`
      INSERT INTO "StylistAccount" (
        account_id, created_by_user_id, created_at, pricing_plan,
        payment_status, account_status, subscription_status, subscription_id
      ) VALUES (
        ${accountId}, 'usr_now', now(), 'FREE',
        'UNPAID', 'ACTIVE', 'ACTIVE', 'sub_replacement'
      )
    `;
    const eventAt = new Date();
    const mutation = {
      accountId,
      pricingPlan: 'FREE' as const,
      paymentStatus: 'PAID' as const,
      accountStatus: 'ACTIVE' as const,
      subscriptionStatus: 'ACTIVE' as const,
      subscriptionId: 'sub_before_replacement',
      expectedSubscriptionId: 'sub_before_replacement',
      cancelAtPeriodEnd: false,
      cancelAt: null,
      currentPeriodEnd: null,
      stripeEventAt: eventAt,
    };
    try {
      expect(await updateAccountPlanStatus(mutation)).toBe(false);
      expect(
        await client().stylistAccount.findUnique({
          where: { account_id: accountId },
          select: {
            subscription_id: true,
            payment_status: true,
            last_stripe_event_at: true,
          },
        })
      ).toEqual({
        subscription_id: 'sub_replacement',
        payment_status: 'UNPAID',
        last_stripe_event_at: null,
      });
      expect(
        await updateAccountPlanStatus({
          ...mutation,
          subscriptionId: 'sub_replacement',
          expectedSubscriptionId: 'sub_replacement',
        })
      ).toBe(true);
      expect(
        await client().stylistAccount.findUnique({
          where: { account_id: accountId },
          select: { subscription_id: true, payment_status: true },
        })
      ).toEqual({
        subscription_id: 'sub_replacement',
        payment_status: 'PAID',
      });
    } finally {
      await client()
        .$executeRaw`DELETE FROM "StylistAccount" WHERE account_id = ${accountId}`;
    }
  });
}
