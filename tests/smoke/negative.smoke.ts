/**
 * Negative / Security smoke tests
 *
 * Covers: INVALID_TOKEN, MISSING_TOKEN, SESSION_GET_CURRENT_NO_AUTH_RETURNS_EMPTY,
 *         RBAC_CLIENT_CANNOT_CHANGE_DISPLAY_NAME, VALIDATION_EMPTY_NAME,
 *         VALIDATION_MISSING_FIELD, VALIDATION_EMPTY_DISPLAY_NAME,
 *         VALIDATION_MISSING_NAIL_LENGTH, VALIDATION_INVALID_NAIL_LENGTH
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';

export async function runNegativeTests(ctx: TestContext): Promise<void> {
  console.log('\n\uD83D\uDD12 NEGATIVE TESTS (Security)\n');

  await test('INVALID_TOKEN', async () => {
    // Use protected endpoint with invalid token
    const response = await apiCall({
      endpoint: '/api/v1/user/change-name',
      method: 'POST',
      token: 'invalid_token_12345',
      body: { name: 'Test' },
    });
    assert.status(response, 401, 'Should reject invalid token');
  });

  await test('MISSING_TOKEN', async () => {
    // Use protected endpoint with invalid token
    const response = await apiCall({
      endpoint: '/api/v1/user/change-name',
      method: 'POST',
      body: { name: 'Test' },
    });
    assert.status(response, 401, 'Should reject missing token');
  });

  await test('SESSION_GET_CURRENT_NO_AUTH_RETURNS_EMPTY', async () => {
    // session/get-current is in BASE_PERMISSIONS (accessible without auth)
    // When no valid session, backend returns {event: "SUCCESS"} without data key
    const response = await apiCall({
      endpoint: '/api/v1/session/get-current',
    });
    assert.status(response, 200, 'Should return 200 (in BASE_PERMISSIONS)');
    const body = response.body as { event?: string; data?: unknown };
    assert.equals(
      !body?.data || !(body.data as Record<string, unknown>)?.id,
      true,
      'Should have no session data without token'
    );
  });

  await test('RBAC_CLIENT_CANNOT_CHANGE_DISPLAY_NAME', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/account/display-name-change',
      method: 'POST',
      token: ctx.clientToken, // Client trying stylist endpoint
      body: { display_name: 'Hacked Salon' },
    });
    // DECISION (nie usuwaj tego komentarza):
    // ACCOUNT_DISPLAY_NAME_CHANGE jest w STYLIST_SPECIFIC_PERMISSIONS (nie CLIENT_SPECIFIC).
    // Middleware HTTPRequestHandlerMiddleware krok 5: RBAC check PRZED business logic.
    // Klient ma sesję (jest authenticated) ale brak tej permission →
    //   statusCode = user ? 403 : 401  (request.middleware.ts:185)
    // → zawsze 403 z event UNAUTHORIZED. requireStylistAccount nigdy nie odpala
    // (business logic nie jest wywoływane). "400 no stylist account" był błędnym założeniem.
    assert.status(response, 403, 'CLIENT must get 403 — RBAC blocks before business logic');
  });

  await test('VALIDATION_EMPTY_NAME', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/change-name',
      method: 'POST',
      token: ctx.stylistToken,
      body: { name: '' },
    });
    assert.status(response, 400, 'Should reject empty name');
  });

  await test('VALIDATION_MISSING_FIELD', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/user/change-name',
      method: 'POST',
      token: ctx.stylistToken,
      body: {}, // Missing 'name' field
    });
    assert.status(response, 400, 'Should reject missing field');
  });

  await test('VALIDATION_EMPTY_DISPLAY_NAME', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/account/display-name-change',
      method: 'POST',
      token: ctx.stylistToken,
      body: { display_name: '' },
    });
    assert.status(response, 400, 'Should reject empty display name');
  });

  await test('VALIDATION_MISSING_NAIL_LENGTH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        asset_url: 'https://test.cloudinary.com/test.jpg',
        trait_ids: [],
        color_ids: [],
        // nail_length missing - should fail
      },
    });
    assert.status(response, 400, 'Should reject missing nail_length');

    // Verify error message mentions nail_length
    const errorData = getData<Record<string, string> | undefined>(response);
    if (errorData && errorData.nail_length) {
      // Error message should exist for nail_length field
      assert.equals(
        typeof errorData.nail_length,
        'string',
        'Should have nail_length error message'
      );
    }
  });

  await test('VALIDATION_INVALID_NAIL_LENGTH', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/gallery/create-gallery-record',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        asset_url: 'https://test.cloudinary.com/test.jpg',
        trait_ids: [],
        color_ids: [],
        nail_length: 'INVALID_VALUE',
      },
    });
    assert.status(response, 400, 'Should reject invalid nail_length');
  });
}
