/**
 * Stripe webhook security layer smoke tests
 *
 * Actual webhook processing requires a valid Stripe signature,
 * so we test the security boundary: reject GET, reject missing/invalid signature.
 */

import { test, apiCall, assert } from './_test-utils';

const WEBHOOK_ENDPOINT = '/api/v1/webhooks/stripe';

export async function runWebhookTests(): Promise<void> {
  await test('WEBHOOK_STRIPE_REJECTS_GET', async () => {
    const response = await apiCall({
      endpoint: WEBHOOK_ENDPOINT,
      method: 'GET',
    });
    assert.status(response, 400);
  });

  await test('WEBHOOK_STRIPE_REJECTS_MISSING_SIGNATURE', async () => {
    const response = await apiCall({
      endpoint: WEBHOOK_ENDPOINT,
      method: 'POST',
      body: { type: 'checkout.session.completed' },
    });
    assert.status(response, 400);
  });

  await test('WEBHOOK_STRIPE_REJECTS_INVALID_SIGNATURE', async () => {
    const response = await apiCall({
      endpoint: WEBHOOK_ENDPOINT,
      method: 'POST',
      body: { type: 'checkout.session.completed' },
      headers: {
        'stripe-signature': 't=1234567890,v1=invalid_signature_value',
      },
    });
    assert.status(response, 400);
  });
}
