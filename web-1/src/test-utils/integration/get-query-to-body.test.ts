import { describe, it, expect } from 'vitest';
import deleteConfirmHandler from '../../pages/api/v1/user/delete/confirm/index';
import { mockApiHandler, mockDb } from '../mockApiHandler';
import { __setPermission } from '../setup';
import { createDeleteConfirmToken } from '@app/email-handler/email-delete-confirm.token';

describe('defineHandler mapRequest - GET query->body promotion (W8.2 regression)', () => {
  it('delete/confirm WITH ?token -> reaches handler (NOT 400 validation)', async () => {
    __setPermission(true);
    // Valid HMAC token: clears the validator (length >= 20) AND verifyDeleteConfirmToken
    // (same dev-fallback secret at mint + verify), so the request passes into the op.
    const token = createDeleteConfirmToken('u_regression_test', 0);
    // No such user -> USER_NOT_FOUND -> 404 (a deterministic, non-400 outcome that
    // proves the token cleared validation; the whole point is status is NOT 400).
    mockDb({ user: { findUnique: async () => null } });

    const { status } = await mockApiHandler(deleteConfirmHandler, {
      method: 'GET',
      query: { token },
    });

    // mapRequest promoted query -> body so the validator passed; without the hook this
    // is 400 (validator sees an empty body).
    expect(status).not.toBe(400);
  });

  it('delete/confirm WITHOUT query params -> 400 (validator sees empty body)', async () => {
    __setPermission(true);
    // No DB mock: validation fails before the operation runs, so no DB access happens.
    const { status } = await mockApiHandler(deleteConfirmHandler, {
      method: 'GET',
    });
    expect(status).toBe(400);
  });
});
