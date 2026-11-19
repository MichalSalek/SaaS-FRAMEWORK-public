/**
 * One statement per operation; tests execute these same statements through the production store.
 * The database clock controls leases and deadlines, including across independently clocked workers.
 * Parameters are bound by the caller and never interpolated into this static SQL.
 */
export const READ_CHECKOUT_ATTEMPT_SQL = `
SELECT *, clock_timestamp() AS db_now FROM "CheckoutAttempt" WHERE "account_id" = $1
`;

// lock-discipline-allow: serialize first claim with user-locked account and webhook operations.
export const CLAIM_CHECKOUT_ATTEMPT_SQL = `
WITH "owned_user" AS MATERIALIZED (
  SELECT u."id" FROM "users" u JOIN "StylistAccount" a ON a."created_by_user_id" = u."id"
  WHERE a."account_id" = $1 FOR UPDATE OF u
)
INSERT INTO "CheckoutAttempt" ("account_id", "phase", "lease_owner", "lease_expires_at", "updated_at")
SELECT $1, 'empty', $2::uuid, clock_timestamp() + ($3::double precision * interval '1 millisecond'), clock_timestamp() FROM "owned_user"
ON CONFLICT ("account_id") DO UPDATE SET
  "lease_owner" = EXCLUDED."lease_owner", "lease_expires_at" = clock_timestamp() + ($3::double precision * interval '1 millisecond'), "updated_at" = clock_timestamp()
WHERE "CheckoutAttempt"."lease_expires_at" IS NULL OR "CheckoutAttempt"."lease_expires_at" <= clock_timestamp()
RETURNING *, clock_timestamp() AS db_now
`;

export const START_CHECKOUT_ATTEMPT_SQL = `
UPDATE "CheckoutAttempt" SET
  "attempt_id" = $3::uuid, "intent_fingerprint" = $4, "intent" = $5::jsonb,
  "stripe_params" = NULL, "response_meta" = NULL, "stripe_session_id" = NULL,
  "stripe_subscription_id" = NULL, "customer_id" = NULL, "phase" = 'preparing',
  "expires_at" = clock_timestamp() + ($6::double precision * interval '1 millisecond'), "updated_at" = clock_timestamp()
WHERE "account_id" = $1 AND "lease_owner" = $2::uuid AND "lease_expires_at" > clock_timestamp()
  AND "phase" IN ('empty', 'expired')
RETURNING *, clock_timestamp() AS db_now
`;

// lock-discipline-allow: user, then checkout attempt, then account, in one statement.
export const PREPARE_CHECKOUT_ATTEMPT_SQL = `
WITH "owned_user" AS MATERIALIZED (
  SELECT u."id" FROM "users" u JOIN "StylistAccount" a ON a."created_by_user_id" = u."id"
  WHERE a."account_id" = $1 FOR UPDATE OF u
), "owned_attempt" AS MATERIALIZED (
  SELECT t."account_id" FROM "CheckoutAttempt" t CROSS JOIN "owned_user" u
  WHERE t."account_id" = $1 AND t."lease_owner" = $2::uuid
    AND t."lease_expires_at" > clock_timestamp() AND t."attempt_id" = $3::uuid
    AND t."phase" = 'preparing' FOR UPDATE OF t
), "eligible_trial_account" AS MATERIALIZED (
  SELECT a."account_id" FROM "StylistAccount" a
  JOIN "owned_attempt" o ON o."account_id" = a."account_id"
  WHERE (a."subscription_id" IS NULL OR a."subscription_status" IN ('CANCELED', 'INCOMPLETE_EXPIRED'))
    AND (($4::jsonb #> '{subscription_data,trial_period_days}') IS NULL OR
      (a."trial_started_at" IS NULL AND a."payment_status" IN ('UNPAID', 'REJECTED'))) FOR UPDATE OF a
)
UPDATE "CheckoutAttempt" SET "stripe_params" = $4::jsonb, "response_meta" = $5::jsonb,
  "customer_id" = $6, "updated_at" = clock_timestamp()
WHERE "account_id" = $1 AND "lease_owner" = $2::uuid AND "lease_expires_at" > clock_timestamp()
  AND "attempt_id" = $3::uuid AND "phase" = 'preparing'
  AND "stripe_params" IS NULL AND "response_meta" IS NULL AND "customer_id" IS NULL
  AND EXISTS (SELECT 1 FROM "owned_attempt")
  AND EXISTS (SELECT 1 FROM "eligible_trial_account")
RETURNING *, clock_timestamp() AS db_now
`;

export const SESSION_CHECKOUT_ATTEMPT_SQL = `
UPDATE "CheckoutAttempt" SET "stripe_session_id" = COALESCE($4, "stripe_session_id"),
  "stripe_subscription_id" = COALESCE($5, "stripe_subscription_id"), "phase" = $6, "updated_at" = clock_timestamp()
WHERE "account_id" = $1 AND "lease_owner" = $2::uuid AND "lease_expires_at" > clock_timestamp()
  AND "attempt_id" = $3::uuid AND ("phase" IN ('preparing', 'open') OR "phase" = $6)
RETURNING *, clock_timestamp() AS db_now
`;

export const EXPIRE_CHECKOUT_ATTEMPT_SQL = `
UPDATE "CheckoutAttempt" SET "phase" = 'expired', "updated_at" = clock_timestamp()
WHERE "account_id" = $1 AND "lease_owner" = $2::uuid AND "lease_expires_at" > clock_timestamp()
  AND "attempt_id" = $3::uuid AND "phase" IN ('preparing', 'open', 'completed', 'expired')
RETURNING *, clock_timestamp() AS db_now
`;

export const RELEASE_CHECKOUT_ATTEMPT_SQL = `
UPDATE "CheckoutAttempt" SET "lease_owner" = NULL, "lease_expires_at" = NULL, "updated_at" = clock_timestamp()
WHERE "account_id" = $1 AND "lease_owner" = $2::uuid AND "lease_expires_at" > clock_timestamp()
RETURNING *, clock_timestamp() AS db_now
`;
