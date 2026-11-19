// Bound parameters: account ID, lease owner UUID. The row lock remains held until
// the transaction commits, preventing a successor claim between the fence and Free CAS.
// Recheck the deadline in UPDATE: the CTE predicate may have been evaluated before a lock wait.
// lock-discipline-allow: the lease row must remain locked through the Free CAS in this single statement
export const CHECKOUT_FREE_FENCED_UPDATE_SQL = `
WITH live_lease AS (
  SELECT account_id, lease_expires_at
  FROM "CheckoutAttempt"
  WHERE account_id = $1 AND lease_owner = $2::uuid
    AND lease_expires_at > clock_timestamp()
  FOR UPDATE
)
UPDATE "StylistAccount" AS account
SET pricing_plan = 'FREE', payment_status = 'UNPAID',
    current_period_end = NULL, plan_selected_at = CURRENT_TIMESTAMP
FROM live_lease
WHERE account.account_id = live_lease.account_id
  AND live_lease.lease_expires_at > clock_timestamp()
  AND (account.subscription_id IS NULL OR account.subscription_status IS NULL
       OR account.subscription_status NOT IN ('ACTIVE', 'TRIALING', 'PAST_DUE'))
`;
