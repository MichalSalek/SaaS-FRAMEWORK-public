/**
 * Session Container domain contract smoke tests
 *
 * Contract tests for session-container endpoints not covered by existing smoke tests.
 * Tests auth (401) and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - SESSION_CONTAINER_GET_MY (auth + HAPPY PATH)
 * - SESSION_CONTAINER_GET_BY_ID (auth + query validation)
 * - SESSION_CONTAINER_SET_NOTE (auth + body validation)
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';

export async function runSessionContainerContractTests(
  ctx: TestContext
): Promise<void> {
  // ── SESSION_CONTAINER_GET_MY ──

  await test('SESSION_CONTAINER_GET_MY_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/session-container/get-my',
      method: 'GET',
    });
    assert.status(res, 401);
  });

  // ── SESSION_CONTAINER_GET_BY_ID ──

  await test('SESSION_CONTAINER_GET_BY_ID_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/session-container/get-by-id?session_id=fake_id',
      method: 'GET',
    });
    assert.status(res, 401);
  });

  await test('SESSION_CONTAINER_GET_BY_ID_VALIDATES_QUERY', async () => {
    // Missing session_id query param → 400
    const res = await apiCall({
      endpoint: '/api/v1/session-container/get-by-id',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(res, 400);
  });

  // ── SESSION_CONTAINER_SET_NOTE ──

  await test('SESSION_CONTAINER_SET_NOTE_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/session-container/set-note',
      method: 'POST',
      body: { session_id: 'fake_id', note: 'test', side: 'stylist' },
    });
    assert.status(res, 401);
  });

  await test('SESSION_CONTAINER_SET_NOTE_VALIDATES_BODY', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/session-container/set-note',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });
    assert.status(res, 400);
  });

  await test('SESSION_CONTAINER_SET_NOTE_REJECTS_INVALID_SIDE', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/session-container/set-note',
      method: 'POST',
      token: ctx.stylistToken,
      body: { session_id: 'fake_id', note: 'test', side: 'invalid_side' },
    });
    assert.status(res, 400);
  });

  // ── HAPPY PATH: lista własnych kontenerów ──
  // Trzy testy wyżej zawracają na 401/400 PRZED zapytaniem do bazy, więc sam
  // odczyt (kursorowa lista + kształt DTO) nie był wykonywany ani razu — ta
  // sama klasa pozornego pokrycia, która przepuściła 500 na
  // CLIENT_GET_CONTACT_FOR_STYLIST (patrz nagłówek client-contract.smoke.ts).
  // Bezstanowy: nie tworzy kontenera, działa też przy pustej liście.
  await test('SESSION_CONTAINER_GET_MY_RETURNS_LIST', async () => {
    const res = await apiCall({
      endpoint: '/api/v1/session-container/get-my?take=5',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(res, 200);
    const data =
      getData<SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_GET_MY']['RESPONSE']>(
        res
      );
    assert.equals(
      Array.isArray(data.sessions),
      true,
      'sessions must be an array even when empty'
    );
    assert.hasProperty(data, 'nextCursor');
  });
}
