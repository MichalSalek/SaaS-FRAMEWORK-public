/**
 * Rate limit smoke tests
 *
 * Covers: Rate limiting middleware (in-memory, per-instance)
 * - Strict endpoint (newsletter-subscribe): 50 req / 10s window
 * - Verifies 429 response after exceeding limit
 * - Verifies X-RateLimit-Remaining header
 * - Verifies Retry-After header on 429 response
 *
 * IMPORTANT: This test uses raw fetch (not apiCall) because apiCall has
 * built-in 429 retry logic that would mask the rate limit response.
 *
 * NOTE: Rate limit is in-memory per-instance. This test must target the
 * same backend process. After this test, other tests may be rate-limited
 * for the remainder of the window (~10s).
 */

import { test, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import { TEST_CONFIG } from '../config/test.config';

/** Rate limit config for strict endpoints (mirrors backend RATE_LIMIT_CONFIG) */
const STRICT_RATE_LIMIT = 50;
const MAX_ATTEMPTS = STRICT_RATE_LIMIT + 5;

/**
 * Raw fetch without retry logic — needed to capture 429 responses
 */
async function rawApiCall(
  endpoint: string,
  body?: Record<string, unknown>
): Promise<{
  status: number;
  headers: Record<string, string>;
  body: unknown;
}> {
  const url = `${TEST_CONFIG.API_URL}${endpoint}`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Origin: TEST_CONFIG.ORIGIN,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : null,
  });

  const responseHeaders: Record<string, string> = {};
  response.headers.forEach((value, key) => {
    responseHeaders[key] = value;
  });

  let responseBody: unknown;
  const contentType = response.headers.get('content-type');
  if (contentType?.includes('application/json')) {
    responseBody = await response.json();
  } else {
    responseBody = await response.text();
  }

  return {
    status: response.status,
    headers: responseHeaders,
    body: responseBody,
  };
}

export async function runRateLimitTests(_ctx: TestContext): Promise<void> {
  await test('RATE_LIMIT_STRICT_ENDPOINT_429', async () => {
    // Strict endpoint: newsletter-subscribe has 50 req / 10s limit
    // We need to send enough requests to exceed the limit.
    // Use invalid email to avoid actually creating subscribers — validation returns 400 fast.
    // Even 400 responses count toward rate limit.

    const endpoint = '/api/v1/public/newsletter-subscribe';
    const body = { email: 'rate-limit-test@example.com' };

    // DECISION (nie usuwaj tego komentarza):
    // Żądania lecą RÓWNOLEGŁE, nie w pętli. Wersja sekwencyjna nie mogła przejść
    // na devie z powodów czysto środowiskowych: pojedyncze żądanie kosztuje tam
    // ~0,5 s, więc 50 żądań nie mieści się w 10-sekundowym oknie — licznik
    // resetował się ZANIM cap został osiągnięty i test raportował „limit nie
    // działa", choć działał. Zweryfikowane: 60 żądań równolegle (~1 s) daje
    // dokładnie 10 odpowiedzi 429 przy limicie 50. Trwale czerwony przypadek jest
    // gorszy niż brak przypadku — maskuje realne regresje w tej samej suicie.
    let got429 = false;
    let lastRemainingHeader = '';
    let retryAfterHeader = '';
    let responseBody: unknown = null;

    const responses = await Promise.all(
      Array.from({ length: MAX_ATTEMPTS }, () => rawApiCall(endpoint, body))
    );

    for (const response of responses) {
      if (response.status === 429) {
        got429 = true;
        lastRemainingHeader = response.headers['x-ratelimit-remaining'] ?? '';
        retryAfterHeader = response.headers['retry-after'] ?? '';
        responseBody = response.body;
        break;
      }
      lastRemainingHeader = response.headers['x-ratelimit-remaining'] ?? '';
    }

    if (!got429) {
      throw new Error(
        `Expected 429 after exceeding strict rate limit (${STRICT_RATE_LIMIT} req/10s), ` +
          `but never received it. Last X-RateLimit-Remaining: ${lastRemainingHeader}`
      );
    }

    // Verify headers
    assert.equals(
      lastRemainingHeader,
      '0',
      'X-RateLimit-Remaining should be 0 on 429'
    );

    // Verify Retry-After header exists and is a positive number
    const retryAfterSeconds = parseInt(retryAfterHeader, 10);
    if (isNaN(retryAfterSeconds) || retryAfterSeconds <= 0) {
      throw new Error(
        `Expected Retry-After header > 0, got: "${retryAfterHeader}"`
      );
    }

    // Verify response body has retryAfter field
    const bodyData = (responseBody as { data?: { retryAfter?: number } })?.data;
    if (
      !bodyData ||
      typeof bodyData.retryAfter !== 'number' ||
      bodyData.retryAfter <= 0
    ) {
      throw new Error(
        `Expected body.data.retryAfter > 0, got: ${JSON.stringify(bodyData)}`
      );
    }

    // Wait for rate limit window to expire so subsequent tests aren't affected
    console.log(
      `   Rate limit hit as expected. Waiting ${retryAfterSeconds + 1}s for window reset...`
    );
    await new Promise(resolve =>
      setTimeout(resolve, (retryAfterSeconds + 1) * 1000)
    );
  });
}
