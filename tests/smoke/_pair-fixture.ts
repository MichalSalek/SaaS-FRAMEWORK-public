/**
 * Wspólny fixture pary stylistka-klientka dla suit smoke.
 *
 * Karta klientki (wizyty/CRM) i komunikator wiszą na TYM SAMYM wierszu
 * `ClientStylistPair`, tylko sięgają po inne jego pola: karta po
 * `client_user_id`, wątek po `id` pary. Trzymamy jedną sekwencję
 * issue -> claim -> odczyt par, żeby obie suity nie rozjechały się w tym,
 * jak budują stan (i żeby zmiana kontraktu parowania psuła jedno miejsce).
 *
 * Stan budowany WYŁĄCZNIE przez publiczne API — parytet z resztą smoke (zero SQL).
 */

import { apiCall, getData, assert } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

export type ActivePairFixture = {
  /** `ClientStylistPair.id` — klucz wątku komunikatora. */
  pairId: string;
  /** `user_id` klientki — klucz karty klientki (wizyty, notatka CRM). */
  clientUserId: string;
  /** Konto stylistki — potrzebne do rozparowania w cleanupie. */
  stylistAccountId: string;
};

/**
 * Doprowadza główną test-stylistkę i główną test-klientkę do pary ACTIVE.
 * Idempotentne z perspektywy wyniku: jeśli para już istnieje, claim zwraca
 * sukces, a odczyt par i tak oddaje aktualny wiersz.
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
  // `pairs` to UNIA dwóch perspektyw: stylistka widzi klientki (`user_id`),
  // klientka widzi stylistki (`account_id`). Pytamy tokenem stylistki, więc
  // zawężamy jawnie — bez rzutowania, żeby zmiana kontraktu wywaliła się
  // na typach, a nie dopiero w runtime.
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
 * Rozparowanie po teście. Nie rzuca — cleanup nie może przykryć błędu,
 * który wywalił właściwy test (pre-clean w `_setup.ts` i tak domyka stan
 * przy kolejnym runie).
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
