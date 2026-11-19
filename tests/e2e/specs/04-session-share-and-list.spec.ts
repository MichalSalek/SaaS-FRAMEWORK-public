// tests/e2e/specs/04-session-share-and-list.spec.ts
//
// CRITICAL PATH #4 (Session container create + listed for the owner):
//   1. Client creates a session container via the backend (owning side per
//      requireClientAccount in session-container/create).
//   2. Client's "my sessions" listing returns the new container.
//   3. The frontend dashboard for the (separately logged-in) stylist still
//      renders without 5xx — this is the user-facing smoke half of the flow.
//
// DECISION: `session-container/create` is gated by requireClientAccount (the client owns a session
// container; the stylist is attached later via the share flow), so the spec creates with the
// CLIENT token and asserts the client's get-my listing. The stylist dashboard check at the end
// stays to smoke-test the stylist's /app render once a session exists.

import { test, expect } from '@playwright/test';
import { fetchDevLoginToken, loginViaDevToken } from '../helpers/auth';
import { apiCall } from '../helpers/api';
import { E2E_ENV } from '../helpers/env';

test.describe('session container: create + visible in get-my listing', () => {
  let clientToken = '';

  test.beforeAll(async () => {
    clientToken = await fetchDevLoginToken(E2E_ENV.USERS.CLIENT);
  });

  test('newly created session container appears in get-my listing', async ({
    page,
    context,
  }) => {
    // 1. Create a session container via backend (the UI flow for this is the
    //    "start new session" CTA — which itself just calls the same endpoint
    //    via TanStack mutation). Owning side is the CLIENT account.
    const created = await apiCall<{
      data?: { session?: { id?: string }; id?: string };
    }>('/api/v1/session-container/create', {
      method: 'POST',
      token: clientToken,
      body: {},
    });
    // session-container/create creates a resource → respondCreated (201),
    // per web-1/.../session-container/create (CQRS: create commands return 201).
    expect(created.status).toBe(201);
    const sessionId = created.body?.data?.session?.id ?? created.body?.data?.id;
    expect(
      sessionId,
      `create payload: ${JSON.stringify(created.body).slice(0, 200)}`
    ).toBeTruthy();

    // 2. Verify it appears in the listing endpoint for the owning client.
    const list = await apiCall<{
      data?: { sessions?: Array<{ id?: string }> };
    }>('/api/v1/session-container/get-my', { token: clientToken });
    expect(list.status).toBe(200);
    const sessions = list.body?.data?.sessions ?? [];
    const found = sessions.some(s => s.id === sessionId);
    expect(
      found,
      `session ${sessionId} missing from get-my: ${JSON.stringify(sessions).slice(0, 300)}`
    ).toBe(true);

    // 3. Stylist navigates to /app — at minimum the dashboard must render
    //    without 5xx after a fresh container exists in the system.
    await loginViaDevToken(context, E2E_ENV.USERS.STYLIST);
    await page.goto('/app');
    // Deterministic render signal (replaces networkidle): the app shell marks
    // the active bottom tab with aria-current="page" once the dashboard route
    // hydrates (same ARIA-only doctrine as spec 18).
    await expect(
      page.locator('nav button[aria-current="page"]').first()
    ).toBeVisible({ timeout: 15_000 });
    expect(page.url()).toMatch(/\/app(?:\/|$|\?)/);

    // Cleanup — close the container so subsequent runs don't accumulate
    // open containers. close() accepts the `session_id` body key per
    // SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST'].
    await apiCall('/api/v1/session-container/close', {
      method: 'POST',
      token: clientToken,
      body: { session_id: sessionId },
    }).catch(() => undefined);
  });
});
