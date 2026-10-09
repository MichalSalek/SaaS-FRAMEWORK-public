/**
 * Regression pin for BDX W8.2 (closing-review HIGH finding).
 *
 * Several GET handlers (confirm-email-change, delete/confirm, and the now-removed
 * public og-meta) carry a `mapRequest` hook that promotes query params into the body
 * (`req.body = { token: req.query.token }`) so the body-reading validator can see them
 * (token-confirmation links opened as plain GET requests). The W2.2 codemod once
 * dropped that preamble outright, which made these endpoints 400 on every request;
 * W8.2 restored it via `defineHandler`'s `mapRequest` hook. This test fails if the hook
 * is dropped again (the WITH-query case flips back to a validation 400).
 *
 * SUBJECT: user/delete/confirm (USER_DELETE_CONFIRM). The original pin used og-meta,
 * which was deleted as a dead public endpoint; the promotion pattern is unchanged and
 * still load-bearing for the surviving confirm handlers (delete/confirm and
 * confirm-email-change share byte-identical `mapRequest` + token validator), so the pin
 * simply re-points at one of the survivors.
 *
 * WHY A REAL TOKEN: the delete-confirm validator requires a token of trimmed length
 * >= 20, AND the operation's HMAC check (verifyDeleteConfirmToken) rejects a forged
 * token with DELETE_CONFIRM_INVALID_TOKEN -> 400. A random 20-char token would 400 at
 * the operation, which is indistinguishable from the validation 400 we are guarding
 * against. So CASE A mints a VALID HMAC token (deterministic dev-fallback secret under
 * the DEVELOPMENT test env) that clears BOTH the validator and the HMAC check, then
 * reaches the DB. With user.findUnique -> null the operation returns USER_NOT_FOUND ->
 * 404, which is NOT 400: the exact signal that mapRequest promoted query -> body.
 */
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
