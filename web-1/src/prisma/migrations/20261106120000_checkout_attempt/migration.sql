-- Durable, fenced checkout coordination. Provider secrets are never stored here.
CREATE TABLE IF NOT EXISTS "CheckoutAttempt" (
  "account_id" TEXT NOT NULL PRIMARY KEY,
  "attempt_id" UUID,
  "intent_fingerprint" TEXT,
  "intent" JSONB,
  "stripe_params" JSONB,
  "response_meta" JSONB,
  "stripe_session_id" TEXT,
  "stripe_subscription_id" TEXT,
  "customer_id" TEXT,
  "phase" TEXT NOT NULL DEFAULT 'empty',
  "lease_owner" UUID,
  "lease_expires_at" TIMESTAMPTZ(3),
  "expires_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CheckoutAttempt_account_id_fkey" FOREIGN KEY ("account_id")
    REFERENCES "StylistAccount"("account_id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "CheckoutAttempt_phase_check" CHECK ("phase" IN ('empty', 'preparing', 'open', 'completed', 'expired')),
  CONSTRAINT "CheckoutAttempt_lease_pair_check" CHECK (("lease_owner" IS NULL) = ("lease_expires_at" IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutAttempt_attempt_id_key" ON "CheckoutAttempt"("attempt_id");
CREATE UNIQUE INDEX IF NOT EXISTS "CheckoutAttempt_stripe_session_id_key" ON "CheckoutAttempt"("stripe_session_id");
