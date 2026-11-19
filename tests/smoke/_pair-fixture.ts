/**
 * Shared stylist-client pair fixture for the smoke suites.
 *
 * The client card (visits/CRM) and the messenger hang on the SAME `ClientStylistPair` row, reading
 * different fields: the card by `client_user_id`, the thread by the pair `id`. One issue -> claim ->
 * read-pairs sequence keeps both suites building state the same way, so a pairing-contract change
 * breaks one place.
 *
 * State is built ONLY through the public API, like the rest of smoke (no SQL).
 */

import { apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

export type ActivePairFixture = {
  /** `ClientStylistPair.id`, the messenger thread key. */
  pairId: string;
  /** The client's `user_id`, the client card key (visits, CRM note). */
  clientUserId: string;
  /** Stylist account, needed to unpair in cleanup. */
  stylistAccountId: string;
};

/**
 * Brings the main test stylist and main test client to an ACTIVE pair. If the pair already exists the
 * claim is expected to return success and the pairs read returns the current row (no test pins a
 * repeated claim).
 */
export const ensureActivePair = async (
  ctx: TestContext
): Promise<ActivePairFixture> => {
  const issue = await apiCall({
    endpoint: ROUTES_API.PAIRING_SESSION_ISSUE,
    method: 'POST',
    token: ctx.stylistToken,
    body: {},
  });
  if (issue.status !== 201 && issue.status !== 200) {
    // Status alone is not diagnosable here: issue-session answers 403 for BOTH
    // "caller is not a stylist" (requireStylistAccount) and "plan pair-cap
    // reached" (PAIRING_LIMIT_REACHED), and this throw aborts the WHOLE run —
    // so a bare number leaves nothing to work from in the crash log.
    throw new Error(
      `issue-session failed: ${issue.status} ${JSON.stringify(issue.body).slice(0, 300)}`
    );
  }
  const issueData =
    getData<PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE']>(issue);

  const claim = await apiCall({
    endpoint: ROUTES_API.PAIRING_SESSION_CLAIM,
    method: 'POST',
    token: ctx.clientToken,
    body: { token: issueData.token },
  });
  if (claim.status !== 200 && claim.status !== 201) {
    throw new Error(`claim-session failed: ${claim.status}`);
  }

  const pairs = await apiCall({
    endpoint: ROUTES_API.PAIRING_GET_MY_PAIRS,
    method: 'GET',
    token: ctx.stylistToken,
  });
  assert.status(pairs, 200);
  const pairsData =
    getData<PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']>(pairs);
  // `pairs` is a UNION of two perspectives: a stylist sees clients (`user_id`), a client sees stylists
  // (`account_id`). We query with the stylist token, so we narrow explicitly (no cast) and a contract
  // change fails on types instead of at runtime.
  const first = pairsData.pairs.find(pair => 'user_id' in pair);
  if (!first || !('user_id' in first)) {
    throw new Error('No client-side pair after claim — fixture cannot proceed');
  }

  return {
    pairId: first.id,
    clientUserId: first.user_id,
    stylistAccountId: issueData.stylist_account_id,
  };
};

/**
 * Unpairs after a test. Never throws: cleanup must not mask the error that failed the real test
 * (the pre-clean in `_setup.ts` settles the state on the next run anyway).
 */
export const revokePairQuietly = async (
  ctx: TestContext,
  stylistAccountId: string
): Promise<void> => {
  if (!stylistAccountId) {
    return;
  }
  try {
    await apiCall({
      endpoint: ROUTES_API.PAIRING_ACCESS_REVOKE,
      method: 'POST',
      token: ctx.clientToken,
      body: { target_account_id: stylistAccountId },
    });
  } catch {
    /* celowo cicho — patrz docstring */
  }
};
