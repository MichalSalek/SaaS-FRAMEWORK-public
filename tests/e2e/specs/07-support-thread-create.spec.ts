// tests/e2e/specs/07-support-thread-create.spec.ts
//
// CRITICAL PATH #10 (Support thread create → admin reply → user notified):
//   1. Authenticated stylist creates a support thread via the public support
//      API (the same endpoint the in-app /app/user/support page hits).
//   2. Thread appears in user's "my threads" listing.
//   3. The user-facing /app/user/support page renders without 500.
//
//   We do NOT script the admin reply because that requires loading the
//   admin support inbox in a SECOND browser context, replying as admin,
//   then asserting the notification. That orchestration belongs in the
//   manual `/testy-api` skill (per tests/README.md tier-split). The smoke
//   surface here is: "thread create works end-to-end through the live
//   handler + user can read their thread list".

import { test, expect } from '@playwright/test';
import { fetchDevLoginToken, loginViaDevToken } from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { E2E_ENV } from '../helpers/env';

test.describe('support: stylist creates a thread + sees it in listing', () => {
  let stylistToken = '';

  test.beforeAll(async () => {
    stylistToken = await fetchDevLoginToken(E2E_ENV.USERS.STYLIST);
  });

  test('newly created thread appears in /support/my-threads', async ({
    page,
    context,
  }) => {
    const uniqueSubject = `E2E smoke ${Date.now()}`;
    const created = await apiCall<{
      data?: { thread_id?: string; id?: string };
      event?: string;
    }>('/api/v1/support/create-thread', {
      method: 'POST',
      token: stylistToken,
      // S126: the request carries a category; the server derives the thread
      // title from the first line of the message.
      body: {
        category: 'OTHER',
        message: `${uniqueSubject}\nAutomated e2e check — please ignore.`,
      },
    });
    // Accept 201 (created) OR 429 (rate-limited). Support-thread creation is
    // capped at 5/hour PER USER (s17 hardening) and this smoke shares the seeded
    // stylist, so repeated runs within the hour (CI retries + local iteration ×2
    // projects) legitimately trip the cap. A 429 still proves the endpoint is
    // wired, auth-gated and does not crash — which is what this smoke guards.
    // Reject 401/403 (auth broken) and 5xx (handler crash).
    expect(
      [201, 429].includes(created.status),
      `create-thread body: ${JSON.stringify(created.body).slice(0, 200)}`
    ).toBe(true);
    expect(created.status).not.toBe(401);
    expect(created.status).not.toBe(403);
    // A 429 is only tolerated for the SPECIFIC rate-limit signal — pin the event
    // so an unrelated 429 (e.g. an infra WAF) can't pass as by-design.
    if (created.status === 429) {
      expect(created.body?.event).toBe('RATE_LIMIT_EXCEEDED_INFO');
    }

    const threadId =
      created.status === 201
        ? (created.body?.data?.thread_id ?? created.body?.data?.id)
        : undefined;
    if (created.status === 201) {
      expect(threadId).toBeTruthy();
    }

    const list = await apiCall<{
      data?: {
        threads?: Array<{ thread_id?: string; id?: string; subject?: string }>;
      };
    }>('/api/v1/support/my-threads', { token: stylistToken });
    expect(list.status).toBe(200);
    const threads = list.body?.data?.threads ?? [];
    // Only assert the freshly-created thread is present when we actually created
    // one this run. When rate-limited (429) we cannot mint a new thread, so the
    // listing simply must return successfully (proven above) — its contents are
    // whatever prior runs left.
    if (threadId) {
      const found = threads.some(
        t =>
          t.thread_id === threadId ||
          t.id === threadId ||
          t.subject === uniqueSubject
      );
      expect(
        found,
        `thread ${threadId} (${uniqueSubject}) missing from my-threads: ${JSON.stringify(threads).slice(0, 300)}`
      ).toBe(true);
    }

    // UI smoke — the in-app support landing must load without a 5xx error page.
    // We do not assert on the thread's presence in the rendered DOM because the
    // listing may paginate, lazy-load or filter — the API contract above already
    // covered that.
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
    await page.goto('/app/user/support');

    // Deterministic render signal (replaces networkidle): the support surface
    // exposes its PL copy (wsparcie/pomoc/rozmowy) once the hub hydrates —
    // this is the positive support-surface signal, auto-waiting.
    await expect(
      page.getByText(/wsparcie|pomoc|rozmow/i).first()
    ).toBeVisible({ timeout: 15_000 });

    // Detect an error page structurally — NOT by substring-matching a bare "500"
    // on the body text: legit support content (thread-name timestamps like
    // "E2E smoke 1783515006731", the "N aktywnych rozmów" counter) contains the
    // digits "500" and false-positives an HTTP-500 check. Assert the error-page
    // title is absent + no error-boundary copy.
    await expect(page).not.toHaveTitle(/404|not found|error|500/i);
    const bodyText = (await page.textContent('body')) ?? '';
    expect(bodyText.toLowerCase()).not.toContain('internal server error');
    expect(bodyText.toLowerCase()).not.toContain('application error');
  });
});
