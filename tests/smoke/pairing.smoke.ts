/**
 * Pairing domain smoke tests
 *
 * Covers: PAIRING_GET_MY_PAIRS, PAIRING_OPERATIONS, PAIRING_FULL_FLOW
 */

import { test, apiCall, getData, assert, getEvent } from './_test-utils';
import type { TestContext } from './_test-utils';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

export async function runPairingTests(ctx: TestContext): Promise<void> {
  await test('PAIRING_GET_MY_PAIRS', async () => {
    const response = await apiCall({
      endpoint: '/api/v1/pairing/get-my-pairs',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(response, 200);
    const data =
      getData<PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']>(response);
    assert.hasProperty(data, 'pairs');
    assert.equals(Array.isArray(data.pairs), true, 'Pairs should be array');
    if (data.pairs.length > 0) {
      assert.hasProperty(
        data.pairs[0] as unknown as Record<string, unknown>,
        'paired_at'
      );
      // S76: id = ClientStylistPair.id — klucz wątku komunikatora; UI linkuje
      // "Napisz wiadomość" z list par po tym polu (regresja = martwy przycisk).
      assert.hasProperty(
        data.pairs[0] as unknown as Record<string, unknown>,
        'id'
      );
    }
  });

  await test('PAIRING_OPERATIONS', async () => {
    // Stylist issues pairing session
    const issueResponse = await apiCall({
      endpoint: '/api/v1/pairing/issue-session',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });

    // Accept 201 (success) or 429 (too many active sessions - FREE plan limit)
    if (issueResponse.status === 201) {
      const data =
        getData<PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE']>(
          issueResponse
        );
      const hasSessionData = data.token || data.stylist_account_id;
      assert.equals(!!hasSessionData, true, 'Should have session identifier');
      assert.hasProperty(
        data as unknown as Record<string, unknown>,
        'expires_at'
      );
      assert.equals(typeof data.token, 'string', 'token should be string');

      // DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
      // Wydaną sesję trzeba ODDAĆ. Ten test wystawiał sesję parowania i nigdy jej
      // nie klaimował ani nie unieważniał, więc KAŻDY przebieg pakietu zostawiał
      // jedną wiszącą sesję przy suficie `MAX_ACTIVE_SESSIONS_PER_STYLIST` = 5
      // (TTL 15 minut). Po kilku przebiegach pod rząd `issue-session` zaczynało
      // zwracać 429, a wtedy `ensureActivePair` w innym pliku rzucało i wywracało
      // CAŁY pakiet — objaw pojawiał się więc daleko od przyczyny i wyglądał na
      // niedeterminizm produktu, a nie na dług testów.
      // Gałąź 429 zostaje: przy wyczerpanym suficie to nadal poprawna odpowiedź.
      if (typeof data.token === 'string') {
        await apiCall({
          endpoint: '/api/v1/pairing/revoke-session',
          method: 'POST',
          token: ctx.stylistToken,
          body: { token: data.token },
        }).catch(() => {});
      }
    } else if (issueResponse.status === 429) {
      // FREE plan limit reached - this is expected behavior
      const event = getEvent(issueResponse);
      assert.equals(
        event,
        'TOO_MANY_ACTIVE_SESSIONS',
        'Should return active sessions limit'
      );
    } else {
      throw new Error(`Expected 201 or 429, got ${issueResponse.status}`);
    }
  });
}

export async function runPairingFullFlowTests(ctx: TestContext): Promise<void> {
  await test('PAIRING_FULL_FLOW', async () => {
    // Stylist issues pairing session
    const issueResponse = await apiCall({
      endpoint: '/api/v1/pairing/issue-session',
      method: 'POST',
      token: ctx.stylistToken,
      body: {},
    });

    // Accept 201 (success) or 429 (FREE plan limit)
    if (issueResponse.status === 429) {
      // FREE plan limit reached -- skip full flow test
      return;
    }
    assert.status(issueResponse, 201);

    const issueData =
      getData<PAIRING_DTO_API_V1['PAIRING_SESSION_ISSUE']['RESPONSE']>(
        issueResponse
      );
    assert.equals(typeof issueData.token, 'string', 'token should be string');
    assert.hasProperty(
      issueData as unknown as Record<string, unknown>,
      'stylist_account_id'
    );
    assert.hasProperty(
      issueData as unknown as Record<string, unknown>,
      'expires_at'
    );
    const pairingToken = issueData.token;
    const stylistAccountId = issueData.stylist_account_id;

    // Client claims the session
    const claimResponse = await apiCall({
      endpoint: '/api/v1/pairing/claim-session',
      method: 'POST',
      token: ctx.clientToken,
      body: { token: pairingToken },
    });
    if (claimResponse.status !== 200 && claimResponse.status !== 201) {
      throw new Error(
        `Claim failed: expected 200/201, got ${claimResponse.status}`
      );
    }

    // Client checks access status
    const statusResponse = await apiCall({
      endpoint: `/api/v1/pairing/get-access-status?stylist_account_id=${encodeURIComponent(stylistAccountId)}`,
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(statusResponse, 200);
    const statusData =
      getData<PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE']>(
        statusResponse
      );
    assert.equals(statusData.access, 'PAIRED', 'Should be PAIRED after claim');

    // Client revokes access
    const revokeResponse = await apiCall({
      endpoint: '/api/v1/pairing/revoke-access',
      method: 'POST',
      token: ctx.clientToken,
      body: { target_account_id: stylistAccountId },
    });
    if (revokeResponse.status !== 200 && revokeResponse.status !== 204) {
      throw new Error(
        `Revoke failed: expected 200/204, got ${revokeResponse.status}`
      );
    }

    // Verify access is now PUBLIC
    const verifyResponse = await apiCall({
      endpoint: `/api/v1/pairing/get-access-status?stylist_account_id=${encodeURIComponent(stylistAccountId)}`,
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(verifyResponse, 200);
    const verifyData =
      getData<PAIRING_DTO_API_V1['PAIRING_GET_ACCESS_STATUS']['RESPONSE']>(
        verifyResponse
      );
    assert.equals(verifyData.access, 'PUBLIC', 'Should be PUBLIC after revoke');
  });
}
