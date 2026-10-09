// tests/concurrency/free-select-webhook.concurrency.ts
//
// FAMILY 4 — free-select ⊥ Stripe webhook (CAS guard, finding ioA-2).
//
// THE BUG (pre-fix): selectFreePlan_IO did findUnique → UNCONDITIONAL update. A
// Stripe webhook (customer.subscription.created) committing subscription_id+ACTIVE
// BETWEEN the read and the write got clobbered back to FREE/UNPAID → Stripe bills
// the customer while the account is locally FREE (entitlement mismatch).
//
// THE FIX: casUpdate updateMany guarded "no active paid subscription AT WRITE TIME"
// (subscription_id NULL OR status NULL OR status NOT IN {ACTIVE,TRIALING,PAST_DUE}).
// count===0 ⇒ guard didn't hold ⇒ reclassify (CONFLICT or ACCOUNT_NOT_FOUND).
//
// THE RACE we fire: POST account/checkout-session {planId:FREE} CONCURRENTLY with a
// direct SQL UPDATE setting subscription_id+ACTIVE (faithful DB-level stand-in for
// the webhook writer — the bug is a DB TOCTOU, and forging a signed Stripe event is
// infeasible). We loop so both interleavings occur.
//
// INVARIANT (must ALWAYS hold; would FAIL on the pre-fix code = RED guard):
//   NEVER pricing_plan='FREE' AND subscription_id IS NOT NULL AND
//   subscription_status IN (ACTIVE,TRIALING,PAST_DUE).
// Plus: free-select must NOT touch trial_started_at (history preserved).

import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { fireParallel } from '../utils/api-client';
import { test, assertTrue } from './_harness';
import {
  createEphemeralStylist,
  setSubscriptionState,
  readAccountState,
} from './_fixtures';

const ACTIVE_PAID = new Set(['ACTIVE', 'TRIALING', 'PAST_DUE']);

const isEntitlementMismatch = (s: {
  pricing_plan: string;
  subscription_id: string | null;
  subscription_status: string | null;
}): boolean =>
  s.pricing_plan === 'FREE' &&
  s.subscription_id != null &&
  s.subscription_status != null &&
  ACTIVE_PAID.has(s.subscription_status);

test(
  'free-select racing a webhook subscription write never yields FREE+active-sub',
  async () => {
    const stylist = await createEphemeralStylist('fs-webhook');
    const ITER = 12;

    for (let i = 0; i < ITER; i++) {
      // Reset to a clean, sub-less FREE-eligible state each round.
      await setSubscriptionState(stylist.accountId, {
        pricing_plan: 'FREE',
        subscription_id: null,
        subscription_status: null,
      });

      // Fire BOTH writers as simultaneously as possible: the free-select HTTP
      // call and the "webhook" DB write. We model the DB write as a thunk run
      // inside the same micro-burst via fireParallel's barrier on the HTTP side;
      // the SQL write is kicked off without await right before releasing.
      const subId = `sub_conc_${i}`;
      const webhookWrite = setSubscriptionState(stylist.accountId, {
        pricing_plan: 'PRO',
        subscription_id: subId,
        subscription_status: 'ACTIVE',
      });
      const [freeResp] = await fireParallel([
        {
          endpoint: ROUTES_API.ACCOUNT_CHECKOUT_SESSION,
          method: 'POST',
          token: stylist.token,
          body: { planId: 'FREE', billingPeriod: 'month' },
        },
      ]);
      await webhookWrite;

      assertTrue(
        freeResp.status < 500,
        `iter ${i}: free-select returned ${freeResp.status} (server error): ${JSON.stringify(freeResp.body)}`
      );

      const state = await readAccountState(stylist.accountId);
      if (state == null) {
        throw new Error(`iter ${i}: account vanished`);
      }
      assertTrue(
        !isEntitlementMismatch(state),
        `iter ${i}: ENTITLEMENT MISMATCH — plan=${state.pricing_plan} sub=${state.subscription_id} status=${state.subscription_status}`
      );
    }
  },
  'ioA-2 selectFreePlan CAS guard (free-select ⊥ webhook)'
);

test(
  'free-select on an account with a pre-existing active sub returns CONFLICT, leaves plan paid',
  async () => {
    const stylist = await createEphemeralStylist('fs-conflict');
    // Pre-existing active paid subscription.
    await setSubscriptionState(stylist.accountId, {
      pricing_plan: 'PRO',
      subscription_id: 'sub_preexisting',
      subscription_status: 'ACTIVE',
    });

    const [resp] = await fireParallel([
      {
        endpoint: ROUTES_API.ACCOUNT_CHECKOUT_SESSION,
        method: 'POST',
        token: stylist.token,
        body: { planId: 'FREE', billingPeriod: 'month' },
      },
    ]);

    // CHECKOUT_FREE_PLAN_CONFLICT → 400 (error-mapper). Must NOT have downgraded.
    assertTrue(
      resp.status === 400,
      `expected 400 CONFLICT, got ${resp.status}: ${JSON.stringify(resp.body)}`
    );
    const state = await readAccountState(stylist.accountId);
    assertTrue(
      state?.pricing_plan === 'PRO' && state?.subscription_id === 'sub_preexisting',
      `plan was clobbered: ${JSON.stringify(state)}`
    );
  },
  'ioA-2 free-select guard rejects active-paid downgrade'
);

// Tests register on import; run-concurrency.ts orchestrates execution + teardown.
