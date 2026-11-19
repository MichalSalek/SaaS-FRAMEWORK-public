/**
 * Newsletter smoke tests
 *
 * Covers: NEWSLETTER_SUBSCRIBE (public endpoint, no auth required)
 * - POST happy path (new email) -> 200
 * - POST duplicate -> 200 (anti-enumeration: always returns success)
 * - POST invalid email -> 400 (validation)
 *
 * The NewsletterSubscriber tables are part of the baseline migration, so a 500
 * here is a real failure and fails the test. An earlier version skipped on any
 * 500 ("table may not be migrated yet") and would have hidden one.
 */

import { test, apiCall, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runNewsletterTests(_ctx: TestContext): Promise<void> {
  const testEmail = `smoke-newsletter-${Date.now()}@example.com`;

  await test('NEWSLETTER_SUBSCRIBE_HAPPY_PATH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/public/newsletter-subscribe',
      method: 'POST',
      body: { email: testEmail },
    });

    assert.status(response, 200);
  });

  await test('NEWSLETTER_SUBSCRIBE_DUPLICATE', async () => {
    // Send same email again — should still return 200 (anti-enumeration)
    const response = await apiCall({
      endpoint: '/api/v1/public/newsletter-subscribe',
      method: 'POST',
      body: { email: testEmail },
    });

    assert.status(response, 200);
  });

  await test('NEWSLETTER_SUBSCRIBE_INVALID_EMAIL', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/public/newsletter-subscribe',
      method: 'POST',
      body: { email: 'not-a-valid-email' },
    });

    assert.status(response, 400);
  });
}
