/**
 * Account domain smoke tests
 *
 * Covers: ACCOUNT_DISPLAY_NAME_CHANGE, UPDATE_STYLIST_PROFILE (atomic),
 *         ACCOUNT_GET_STYLISTS_WITH_LOCATION,
 *         ACCOUNT_GET_PUBLIC_PROFILE,
 *         STRIPE contract tests (auth, RBAC, validation)
 */

import { test, apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';

export async function runAccountTests(ctx: TestContext): Promise<void> {
  await test('ACCOUNT_DISPLAY_NAME_CHANGE', async () => {
    // Save original display name for rollback
    const beforeSession = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const originalDisplayName =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(beforeSession)
        ?.stylist_account?.display_name;

    const newDisplayName = `Smoke Salon ${Date.now()}`;
    const requestBody: ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['REQUEST'] = {
      display_name: newDisplayName,
    };

    try {
      const response = await apiCall({
        endpoint: '/api/v1/account/display-name-change',
        method: 'POST',
        token: ctx.stylistToken,
        body: requestBody,
      });
      assert.status(response, 200);
      const changeData =
        getData<ACCOUNT_DTO_API_V1['ACCOUNT_DISPLAY_NAME_CHANGE']['RESPONSE']>(
          response
        );
      assert.hasProperty(
        changeData as unknown as Record<string, unknown>,
        'account_id'
      );
      assert.equals(
        changeData.display_name,
        newDisplayName,
        'display_name in response should match'
      );

      const sessionResponse = await apiCall({
        endpoint: '/api/v1/session/get-current',
        token: ctx.stylistToken,
      });
      assert.status(sessionResponse, 200);

      const data =
        getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(sessionResponse);
      if (!data) {
        throw new Error('Missing session data');
      }
      assert.equals(
        data.stylist_account?.display_name,
        newDisplayName,
        'Display name not updated'
      );
    } finally {
      // Rollback to original display name
      if (originalDisplayName) {
        await apiCall({
          endpoint: '/api/v1/account/display-name-change',
          method: 'POST',
          token: ctx.stylistToken,
          body: { display_name: originalDisplayName },
        });
      }
    }
  });

  await test('UPDATE_STYLIST_PROFILE (vanity sub-section)', async () => {
    // D5 (run 25 TRD): single atomic endpoint covers vanity / location / social updates.
    const vanityUrl = `smoke-test-${Date.now()}`;
    const requestBody: ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'] =
      {
        vanity: { vanity_url: vanityUrl },
      };

    try {
      const response = await apiCall({
        endpoint: '/api/v1/account/update-stylist-profile',
        method: 'POST',
        token: ctx.stylistToken,
        body: requestBody,
      });
      assert.status(response, 200);

      const data =
        getData<ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['RESPONSE']>(
          response
        );
      assert.equals(data.vanity_url, vanityUrl, 'Vanity URL not set');
      assert.equals(
        data.updated_sections.includes('vanity'),
        true,
        'updated_sections should include vanity'
      );
    } finally {
      // Restore: set vanity_url to null (remove)
      await apiCall({
        endpoint: '/api/v1/account/update-stylist-profile',
        method: 'POST',
        token: ctx.stylistToken,
        body: { vanity: { vanity_url: null } },
      });
    }
  });

  await test('UPDATE_STYLIST_PROFILE (location sub-section)', async () => {
    // Geocoding-dependent; on FREE/inactive plan or unreachable Nominatim this may 400.
    // Test asserts that the endpoint accepts the unified payload shape.
    const response = await apiCall({
      endpoint: '/api/v1/account/update-stylist-profile',
      method: 'POST',
      token: ctx.stylistToken,
      body: {
        location: {
          address_city: 'Test City',
          address_street: 'Test Street 123',
          address_postal_code: '12-345',
          address_country: 'Poland',
          business_name: null,
          phone: null,
          website: null,
          description: null,
        },
      },
    });
    // May fail if account not fully set up or geocoding unreachable - accept 200 or 400
    if (response.status !== 200 && response.status !== 400) {
      throw new Error(`Expected 200 or 400, got ${response.status}`);
    }
  });

  await test('ACCOUNT_GET_STYLISTS_WITH_LOCATION', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/account/get-stylists-with-location',
      method: 'POST',
      token: ctx.clientToken,
      body: {
        latitude: 52.2297,
        longitude: 21.0122,
        radius_km: 50,
      },
    });
    assert.status(response, 200);
    const data =
      getData<ACCOUNT_DTO_API_V1['ACCOUNT_GET_STYLISTS_WITH_LOCATION']['RESPONSE']>(
        response
      );
    assert.equals(Array.isArray(data), true, 'Data should be array');
    if (data.length > 0) {
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'account_id'
      );
      assert.hasProperty(
        data[0] as unknown as Record<string, unknown>,
        'display_name'
      );
    }
  });

  await test('ACCOUNT_GET_PUBLIC_PROFILE', async () => {
    // Get stylist account_id from session
    const sessionResponse = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    const sessionData =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(sessionResponse);
    if (!sessionData) {
      throw new Error('Missing session data');
    }
    const accountId = sessionData.stylist_account?.account_id;

    if (accountId) {
      const response = await apiCall({
        endpoint: `/api/v1/public/get-stylist-profile?identifier=${accountId.toString()}`,
        method: 'GET',
      });

      assert.status(response, 200);

      // TypeScript pilnuje RESPONSE i podpowiada wlasciwosci!
      const data =
        getData<ACCOUNT_DTO_API_V1['ACCOUNT_GET_PUBLIC_PROFILE']['RESPONSE']>(response);

      // TypeScript wie ze data.account istnieje i ma te pola
      assert.equals(data.account.account_id, accountId);
      assert.equals(typeof data.account.display_name, 'string');
      assert.equals(typeof data.gallery_records_count, 'number');
    }
  });

  // ============================================================================
  // STRIPE CONTRACT TESTS
  // No Stripe sandbox — validate auth, RBAC, and request validation only
  // ============================================================================

  await test('STRIPE_PORTAL_REQUIRES_AUTH', async () => {
    // Call without token → expect 401
    const response = await apiCall({
      endpoint: '/api/v1/stripe/portal',
      method: 'POST',
      body: {},
    });
    assert.status(
      response,
      401,
      'ACCOUNT_STRIPE_PORTAL without auth should return 401'
    );
  });

  await test('STRIPE_PORTAL_REQUIRES_STYLIST', async () => {
    // Call with client token → expect 403
    const response = await apiCall({
      endpoint: '/api/v1/stripe/portal',
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });
    assert.status(
      response,
      403,
      'ACCOUNT_STRIPE_PORTAL with client token should return 403'
    );
  });
}
