/**
 * Disposable-Postgres proof of the shared invoice predicate.
 * Payment status and plan tier are planted as the old false signals (trial
 * marked PAID, free tier, admin grant) and must not create a sale.
 *
 * FINANCIAL_PROOF_TEST_DATABASE_URL=postgresql://ci:ci@127.0.0.1:55432/metrics
 * npx vitest run --config vitest.postgres.config.ts tests/postgres/financial-invoice-proof.pg.test.ts
 */

import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { Pool } from 'pg';
import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient } from '../../src/prisma/js-client';
import { randomUUID } from 'node:crypto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import {
  currentFinancialSubscriberSql,
  financialFunnelCountColumns,
  financialInvoiceProofCtes,
} from '@domain/admin/operations/financial-invoice-proof';
import { accountSeeds, eventSeeds } from './financial-invoice-proof.pg.fixture';
import {
  createPlanWriteEnums,
  registerInvoicePlanWriteCases,
} from './financial-plan-write.pg.cases';

const holder = vi.hoisted(() => ({ client: null as PrismaClient | null }));
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    get use() {
      if (!holder.client) {
        throw new Error('Test database unavailable');
      }
      return holder.client;
    },
  },
}));

import {
  processPlanCounts,
  queryFunnelMetrics,
  queryRevenueMetrics,
} from '@domain/admin/operations/admin-reports.helpers';

const url = process.env.FINANCIAL_PROOF_TEST_DATABASE_URL;
if (url && !['127.0.0.1', 'localhost'].includes(new URL(url).hostname)) {
  throw new Error('Financial proof requires a disposable loopback database');
}
const schema = `financial_proof_${randomUUID().replaceAll('-', '')}`;
const PAID_EVENT = APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED;

describe.skipIf(!url)('financial invoice proof on Postgres', () => {
  const pool = new Pool({
    connectionString: url,
    max: 2,
    options: `-c search_path=${schema}`,
  });
  const now = new Date();
  const day = (offset: number) =>
    new Date(now.getTime() + offset * 24 * 60 * 60 * 1000);
  const periodStart = day(-40);
  const periodEnd = day(-10);
  const createdAt = day(-30);

  const client = () => {
    if (!holder.client) {
      throw new Error('Test database unavailable');
    }
    return holder.client;
  };

  const classify = async (asOf: Date) => {
    const rows = await client().$queryRaw<
      Array<{
        account_id: string;
        ever_converted: boolean;
        currently_paying: boolean;
      }>
    >(Prisma.sql`
      WITH ${financialInvoiceProofCtes(asOf)}
      SELECT
        sa.account_id,
        EXISTS (
          SELECT 1
          FROM fin_positive_accounts positive
          WHERE positive.account_id = sa.account_id
        ) AS ever_converted,
        (${currentFinancialSubscriberSql}) AS currently_paying
      FROM "StylistAccount" sa
      ORDER BY sa.account_id
    `);
    return new Map(rows.map(row => [row.account_id, row]));
  };

  const funnel = async (asOf: Date) => {
    const rows = await client().$queryRaw<
      Array<{
        funnel_signup_count: bigint;
        funnel_trial_started_count: bigint;
        funnel_trial_to_paid_count: bigint;
        funnel_trial_expired_count: bigint;
        funnel_paid_active_count: bigint;
      }>
    >(Prisma.sql`
      WITH ${financialInvoiceProofCtes(asOf)}
      SELECT ${financialFunnelCountColumns(asOf)}
      FROM "StylistAccount" sa
    `);
    const row = rows[0];
    if (!row) {
      throw new Error('funnel query returned no row');
    }
    return {
      signup: Number(row.funnel_signup_count),
      trialStarted: Number(row.funnel_trial_started_count),
      trialToPaid: Number(row.funnel_trial_to_paid_count),
      trialExpired: Number(row.funnel_trial_expired_count),
      paidActive: Number(row.funnel_paid_active_count),
    };
  };

  beforeAll(async () => {
    await pool.query(`CREATE SCHEMA "${schema}"`);
    await createPlanWriteEnums(pool);
    await pool.query(`
      CREATE TABLE "users" (
        id text PRIMARY KEY,
        email text NOT NULL,
        created_at timestamp(3) NOT NULL
      )
    `);
    await pool.query(`
      CREATE TABLE "StylistAccount" (
        account_id text PRIMARY KEY,
        created_at timestamp(3) NOT NULL,
        created_by_user_id text NOT NULL,
        pricing_plan text NOT NULL,
        payment_status text NOT NULL,
        account_status text NOT NULL,
        subscription_id text,
        subscription_status text,
        cancel_at_period_end boolean,
        cancel_at timestamp(3),
        current_period_end timestamp(3),
        account_expiration_date timestamp(3),
        upcoming_payment_date timestamp(3),
        last_stripe_event_at timestamp(3),
        admin_plan_override boolean NOT NULL DEFAULT false,
        trial_started_at timestamp(3),
        trial_ends_at timestamp(3)
      )
    `);
    await pool.query(`
      CREATE TABLE "EventLog" (
        event_log_id text PRIMARY KEY,
        created_at timestamp(3) NOT NULL,
        event text NOT NULL,
        created_by_user_id text NOT NULL,
        event_payload jsonb,
        event_type text NOT NULL
      )
    `);
    await pool.query(
      `INSERT INTO "users" (id, email, created_at) VALUES ($1, $2, $3), ($4, $5, $6)`,
      [
        'usr_now',
        'now@test.local',
        createdAt,
        'usr_old',
        'old@test.local',
        day(-70),
      ]
    );
    for (const account of accountSeeds()) {
      await pool.query(
        `INSERT INTO "StylistAccount" (
           account_id, created_at, created_by_user_id, pricing_plan, payment_status,
           account_status, subscription_id, subscription_status, admin_plan_override,
           trial_started_at, trial_ends_at
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
        [
          account.id,
          createdAt,
          'usr_now',
          account.plan,
          account.paymentStatus,
          account.accountStatus,
          account.subscriptionId,
          account.subscriptionStatus,
          account.adminGrant,
          account.trial ? day(-28) : null,
          account.trial ? day(-20) : null,
        ]
      );
    }
    for (const event of eventSeeds()) {
      await pool.query(
        `INSERT INTO "EventLog" (
           event_log_id, created_at, event, created_by_user_id, event_payload, event_type
         ) VALUES ($1,$2,$3,$4,$5::jsonb,$6)`,
        [
          event.id,
          day(event.atOffsetDays),
          PAID_EVENT,
          'usr_now',
          event.payload === null ? null : JSON.stringify(event.payload),
          'ACCOUNT',
        ]
      );
    }
    holder.client = new PrismaClient({
      adapter: new PrismaPg(pool, { schema }),
    });
  });

  afterAll(async () => {
    await holder.client?.$disconnect();
    await pool.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
    await pool.end();
  });

  registerInvoicePlanWriteCases(client);

  it('counts a positive invoice and excludes zero, trial, canceled, free, and admin grants', async () => {
    const closed = await classify(periodEnd);
    const expectRow = (
      id: string,
      everConverted: boolean,
      currentlyPaying: boolean
    ) => {
      expect(closed.get(id)).toMatchObject({
        ever_converted: everConverted,
        currently_paying: currentlyPaying,
      });
    };

    expectRow('A', true, true);
    expectRow('B', false, false);
    expectRow('C', true, false);
    expectRow('D', true, false);
    expectRow('E', true, false);
    expectRow('F', false, false);
    expectRow('G', true, false);
    expectRow('H', true, false);
    expectRow('I', false, false);
    expectRow('J', true, true);
    expectRow('K', false, false);
    expectRow('L', true, false);
    expectRow('M', true, false);
    expectRow('N', false, false);
    expectRow('P', true, false);

    const open = await classify(now);
    expect(open.get('K')).toMatchObject({
      ever_converted: true,
      currently_paying: true,
    });
    expect(open.get('N')).toMatchObject({
      ever_converted: false,
      currently_paying: false,
    });
    expect(open.get('D')?.currently_paying).toBe(false);
  });

  it('uses Stripe invoice time when an older positive invoice arrives after a newer zero invoice', async () => {
    const issued = (offset: number) => Math.floor(day(offset).getTime() / 1000);
    await pool.query(
      `INSERT INTO "StylistAccount" (account_id, created_at, created_by_user_id, pricing_plan,
         payment_status, account_status, subscription_id, subscription_status)
       VALUES ('ORDER', $1, 'usr_now', 'PRO', 'PAID', 'ACTIVE', 'sub_order', 'ACTIVE')`,
      [createdAt]
    );
    try {
      for (const [id, amount, invoiceDay, deliveredDay] of [
        ['zero', 0, -20, -19],
        ['old_positive', 1000, -25, -15],
      ] as const) {
        await pool.query(
          `INSERT INTO "EventLog" (event_log_id, created_at, event, created_by_user_id, event_payload, event_type)
           VALUES ($1, $2, $3, 'usr_now', $4::jsonb, 'ACCOUNT')`,
          [
            id,
            day(deliveredDay),
            PAID_EVENT,
            JSON.stringify({
              accountId: 'ORDER',
              invoiceId: id,
              subscriptionId: 'sub_order',
              amountPaid: amount,
              invoiceCreatedAt: issued(invoiceDay),
              paymentConfirmedAt: issued(invoiceDay),
            }),
          ]
        );
      }
      expect((await classify(periodEnd)).get('ORDER')).toMatchObject({
        ever_converted: true,
        currently_paying: false,
      });
    } finally {
      await pool.query(
        `DELETE FROM "EventLog" WHERE event_payload->>'accountId' = 'ORDER'`
      );
      await pool.query(
        `DELETE FROM "StylistAccount" WHERE account_id = 'ORDER'`
      );
    }
  });

  it('rejects fractional minor-unit amounts as financial evidence', async () => {
    await pool.query(
      `INSERT INTO "EventLog" (event_log_id, created_at, event, created_by_user_id, event_payload, event_type)
       VALUES ('fraction', $1, $2, 'usr_now', $3::jsonb, 'ACCOUNT')`,
      [
        day(-15),
        PAID_EVENT,
        JSON.stringify({
          accountId: 'I',
          invoiceId: 'fraction',
          amountPaid: 0.5,
        }),
      ]
    );
    try {
      expect((await classify(periodEnd)).get('I')?.ever_converted).toBe(false);
    } finally {
      await pool.query(
        `DELETE FROM "EventLog" WHERE event_log_id = 'fraction'`
      );
    }
  });

  it('feeds the metrics funnel columns from the same predicate', async () => {
    await expect(funnel(periodEnd)).resolves.toEqual({
      signup: 15,
      trialStarted: 4,
      trialToPaid: 3,
      trialExpired: 1,
      paidActive: 2,
    });
    const open = await funnel(now);
    expect(open.paidActive).toBe(3);
    expect(open.trialToPaid).toBe(3);
    expect(open.trialExpired).toBe(1);
  });

  it('keeps closed report cohorts free of later invoices and prices only current subscribers', async () => {
    const report = await queryFunnelMetrics(
      periodStart,
      periodEnd,
      day(-80),
      periodStart
    );
    expect(report).toMatchObject({
      totalRegsCurrent: 1,
      totalRegsPrev: 1,
      activeAccountsCurrent: 15,
      paidAccountsCurrent: 10,
      paidAccountsPrev: 0,
    });

    const revenue = await queryRevenueMetrics();
    const byPlan = new Map(
      revenue.map(row => [row.pricing_plan, row._count._all])
    );
    expect(byPlan.get(PricingPlanValue.PRO)).toBe(3);
    expect(byPlan.get(PricingPlanValue.FREE)).toBe(2);
    expect(byPlan.get(PricingPlanValue.STUDIO) ?? 0).toBe(0);

    const revenueCounts = processPlanCounts(revenue);
    expect(revenueCounts.PRO).toBe(3);
    expect(revenueCounts.FREE).toBe(2);
    expect(revenueCounts.STUDIO).toBe(0);
  });
});
