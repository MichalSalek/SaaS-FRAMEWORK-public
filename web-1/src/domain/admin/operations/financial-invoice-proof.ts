import { Prisma } from '../../../prisma/js-client';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  AccountStatusValue,
  SubscriptionStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

/**
 * DECISION: sales require positive invoice-payment audit evidence; operational PAID also covers
 * trials and 100% discounts. Legacy rows prove past sales, not a current subscription. (owner)
 * Callers alias StylistAccount as sa. asOf is exclusive.
 * Test: tests/postgres/financial-invoice-proof.pg.test.ts (proof, order and malformed data;
 * not bank collection).
 */

const INVOICE_PAID_EVENT =
  APP_EVENTS.INFO.ACCOUNT.STRIPE_INVOICE_PAYMENT_SUCCEEDED;

/**
 * Numeric amountPaid, or NULL when the legacy payload cannot be read as a number.
 * The cast runs only after a jsonb type guard, so a string, object, or array
 * does not abort the whole dashboard query.
 */
const amountPaidSql = Prisma.sql`
  CASE
    WHEN jsonb_typeof(el.event_payload->'amountPaid') = 'number'
      THEN (el.event_payload->>'amountPaid')::numeric
    WHEN jsonb_typeof(el.event_payload->'amountPaid') = 'string'
      AND btrim(el.event_payload->>'amountPaid') ~ '^[0-9]+([.][0-9]+)?$'
      THEN btrim(el.event_payload->>'amountPaid')::numeric
    ELSE NULL
  END
`;

const textFieldSql = (field: string): Prisma.Sql => Prisma.sql`
  CASE
    WHEN jsonb_typeof(el.event_payload->${field}) = 'string'
      AND btrim(el.event_payload->>${field}) <> ''
      THEN btrim(el.event_payload->>${field})
    ELSE NULL
  END
`;

const invoiceInstantSql = (field: string): Prisma.Sql => Prisma.sql`
  CASE
    WHEN jsonb_typeof(el.event_payload->${field}) = 'number'
      AND el.event_payload->>${field} ~ '^[0-9]{1,12}$'
      THEN to_timestamp((el.event_payload->>${field})::bigint) AT TIME ZONE 'UTC'
    ELSE el.created_at
  END
`;

export const financialInvoiceProofCtes = (asOf: Date): Prisma.Sql => Prisma.sql`
  fin_invoice_events AS (
    SELECT
      el.created_at,
      ${invoiceInstantSql('invoiceCreatedAt')} AS invoice_issued_at,
      ${invoiceInstantSql('paymentConfirmedAt')} AS payment_confirmed_at,
      ${textFieldSql('accountId')} AS account_id,
      COALESCE(
        ${textFieldSql('invoiceId')},
        el.event_log_id
      ) AS invoice_key,
      ${textFieldSql('subscriptionId')} AS subscription_id,
      ${amountPaidSql} AS amount_paid
    FROM "EventLog" el
    WHERE el.event = ${INVOICE_PAID_EVENT}
      AND el.created_at < ${asOf}
      AND jsonb_typeof(el.event_payload) = 'object'
      AND ${invoiceInstantSql('paymentConfirmedAt')} < ${asOf}
      AND ${invoiceInstantSql('invoiceCreatedAt')} < ${asOf}
  ),
  fin_invoice_deduped AS (
    SELECT
      account_id,
      invoice_key,
      MAX(subscription_id) AS subscription_id,
      MAX(amount_paid) AS amount_paid,
      MIN(created_at) AS created_at,
      MIN(invoice_issued_at) AS invoice_issued_at
    FROM fin_invoice_events
    WHERE account_id IS NOT NULL
      AND amount_paid IS NOT NULL
      AND amount_paid = trunc(amount_paid)
    GROUP BY account_id, invoice_key
  ),
  fin_positive_accounts AS (
    SELECT DISTINCT account_id
    FROM fin_invoice_deduped
    WHERE amount_paid > 0
  ),
  fin_latest_subscription_invoice AS (
    SELECT DISTINCT ON (account_id, subscription_id)
      account_id,
      subscription_id,
      amount_paid
    FROM fin_invoice_deduped
    WHERE subscription_id IS NOT NULL
    ORDER BY account_id, subscription_id, invoice_issued_at DESC, amount_paid ASC, invoice_key DESC
  )
`;

/**
 * Engaged paying subscriber: live ACTIVE subscription on a paid plan, not an
 * admin grant, and the latest successful invoice for THAT subscription is
 * a positive amount. Trialing, canceled, free, and past-due are outside this
 * set. A later zero invoice for the same subscription removes it.
 */
export const currentFinancialSubscriberSql = Prisma.sql`
  sa.account_status::text = ${AccountStatusValue.ACTIVE}
  AND sa.pricing_plan::text <> ${PricingPlanValue.FREE}
  AND sa.admin_plan_override IS NOT TRUE
  AND sa.subscription_status::text = ${SubscriptionStatusValue.ACTIVE}
  AND NULLIF(btrim(sa.subscription_id), '') IS NOT NULL
  AND EXISTS (
    SELECT 1
    FROM fin_latest_subscription_invoice latest
    WHERE latest.account_id = sa.account_id
      AND latest.subscription_id = sa.subscription_id
      AND latest.amount_paid > 0
  )
`;

/** Conversion-funnel aggregates that share the CTEs above. Churn stays with the caller. */
export const financialFunnelCountColumns = (
  now: Date
): Prisma.Sql => Prisma.sql`
  COUNT(*)::bigint AS funnel_signup_count,
  COUNT(*) FILTER (
    WHERE sa.trial_started_at IS NOT NULL
  )::bigint AS funnel_trial_started_count,
  COUNT(*) FILTER (
    WHERE sa.trial_started_at IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM fin_positive_accounts positive
        WHERE positive.account_id = sa.account_id
      )
  )::bigint AS funnel_trial_to_paid_count,
  COUNT(*) FILTER (
    WHERE sa.trial_started_at IS NOT NULL
      AND sa.trial_ends_at IS NOT NULL
      AND sa.trial_ends_at < ${now}
      AND NOT EXISTS (
        SELECT 1
        FROM fin_positive_accounts positive
        WHERE positive.account_id = sa.account_id
      )
  )::bigint AS funnel_trial_expired_count,
  COUNT(*) FILTER (
    WHERE ${currentFinancialSubscriberSql}
  )::bigint AS funnel_paid_active_count
`;
