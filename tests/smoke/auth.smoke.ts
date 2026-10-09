/**
 * Auth & Session smoke tests (Better Auth)
 *
 * Covers:
 *   - DEV_LOGIN (bearer token issued by custom dev-login route, delivered via 'authorization' response header)
 *   - BETTER_AUTH_SESSION_UNAUTHENTICATED (GET /api/auth/get-session without auth → null body, 200)
 *   - SESSION_GET_CURRENT (app session endpoint, asserts current-user shape)
 *   - MAGIC_LINK_SEND (POST /api/auth/sign-in/magic-link → 200, triggers Verification row + email)
 *
 */

import {
  test,
  apiCall,
  getData,
  assert,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_DTO_API_V1 } from '@kernel/models/session/session.dto';

export async function runAuthTests(ctx: TestContext): Promise<void> {
  await test('DEV_LOGIN', async () => {
    const requestBody: USER_DTO_API_V1['DEV_LOGIN']['REQUEST'] = {
      email: 'smoke-test@example.com',
    };

    const response = await apiCall({
      endpoint: '/api/auth/dev-login',
      method: 'POST',
      body: requestBody,
    });
    assert.status(response, 200);

    const data = getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(response);
    assert.equals(typeof data.email, 'string');
    assert.equals(data.email, requestBody.email);
    assert.hasProperty(data, 'session');
    const authHeader = extractSessionToken(response);
    assert.equals(
      typeof authHeader,
      'string',
      'response should have authorization header with token'
    );
    assert.hasProperty(data, 'id');
    assert.equals(typeof data.id, 'string', 'id should be string');
  });

  await test('BETTER_AUTH_SESSION_UNAUTHENTICATED', async () => {
    // GET /api/auth/get-session without Authorization header.
    // Better Auth convention: returns 200 with `null` body (no session).
    const response = await apiCall({
      endpoint: '/api/auth/get-session',
      method: 'GET',
    });
    assert.status(response, 200);

    // Body shape: null for unauthenticated (Better Auth). Some deployments may
    // serialize as the string "null" when content-type is text — accept both.
    const body = response.body;
    const isNullish =
      body === null || body === undefined || body === 'null' || body === '';
    if (!isNullish) {
      throw new Error(
        `Expected null body for unauthenticated get-session, got: ${JSON.stringify(body).slice(0, 200)}`
      );
    }
  });

  await test('SESSION_GET_CURRENT', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/session/get-current',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);

    const data =
      getData<SESSION_DTO_API_V1['SESSION_GET_CURRENT']['RESPONSE']>(response);
    assert.equals(typeof data?.email, 'string');
    assert.equals(data?.email.includes('@'), true);
    assert.equals(typeof data?.id, 'string');
    assert.equals(typeof data?.role_id, 'string');
  });

  await test('MAGIC_LINK_SEND', async () => {
    // Better Auth magic-link plugin: POST /api/auth/sign-in/magic-link with { email }.
    // Backend pipes into sendMagicLinkVerificationRequest (Mailgun → SMTP fallback)
    // and writes a Verification row keyed on the email. We only assert the HTTP
    // contract (200 OK) here — DB + email delivery are covered by domain tests.
    const response = await apiCall({
      endpoint: '/api/auth/sign-in/magic-link',
      method: 'POST',
      body: { email: 'smoke-test@example.com' },
    });
    assert.status(response, 200);
  });
}
