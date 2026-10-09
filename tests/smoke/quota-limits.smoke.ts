/**
 * Quota Limits Smoke Tests
 *
 * C3: Paired-stylists-limit (MAX_PAIRED_STYLISTS=3) — client can pair with max 3 stylists
 * C4: Shares-per-hour-limit (FREE plan: 5 shares/hr)
 * C5: Pairing-quota-limit (FREE plan: max 2 paired clients per stylist)
 */

import {
  test,
  apiCall,
  getData,
  getEvent,
  assert,
  getClientToken,
  getAdminToken,
  getStylistToken,
  extractSessionToken,
} from './_test-utils';
import type { TestContext } from './_test-utils';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { SESSION_CONTAINER_DTO_API_V1 } from '@kernel/models/session-container/session-container.dto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

export async function runQuotaLimitTests(_ctx: TestContext): Promise<void> {
  // ── C3: Paired-stylists-limit (client side: MAX_PAIRED_STYLISTS=3) ──
  await test('C3_PAIRED_STYLISTS_LIMIT', async () => {
    const clientToken = await getClientToken();
    const adminToken = await getAdminToken();
    const tempUserIds: string[] = [];
    const tempTokens: string[] = [];

    try {
      // 1. Create 4 temp stylist users
      for (let i = 1; i <= 4; i++) {
        const email = `temp-qa-c3-${i}-${Date.now()}@example.com`;
        const loginRes = await apiCall({
          endpoint: '/api/auth/dev-login',
          method: 'POST',
          body: { email },
        });
        assert.status(loginRes, 200);
        const loginData =
          getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
        const loginToken = extractSessionToken(loginRes);
        tempUserIds.push(loginData.id);
        tempTokens.push(loginToken);

        // 2. Onboard each as stylist
        const onboardRes = await apiCall({
          endpoint: '/api/v1/user/onboard-stylist',
          method: 'POST',
          token: loginToken,
          body: { display_name: `QA C3 Stylist ${i}`, address_city: 'Warsaw' },
        });
        if (onboardRes.status !== 200 && onboardRes.status !== 201) {
          throw new Error(`Stylist onboard ${i} failed: ${onboardRes.status}`);
        }
      }

      // 3. Pair client with stylist 1 → should succeed
      const issue1Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: tempTokens[0],
      });
      assert.status(issue1Res, 201);
      const issue1Data = getData<{ token: string }>(issue1Res);

      const claim1Res = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: clientToken,
        body: { token: issue1Data.token },
      });
      if (claim1Res.status !== 200 && claim1Res.status !== 201) {
        throw new Error(`Pair with stylist 1 failed: ${claim1Res.status}`);
      }

      // 4. Pair client with stylist 2 → should succeed
      const issue2Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: tempTokens[1],
      });
      assert.status(issue2Res, 201);
      const issue2Data = getData<{ token: string }>(issue2Res);

      const claim2Res = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: clientToken,
        body: { token: issue2Data.token },
      });
      if (claim2Res.status !== 200 && claim2Res.status !== 201) {
        throw new Error(`Pair with stylist 2 failed: ${claim2Res.status}`);
      }

      // 5. Pair client with stylist 3 → should succeed (limit is 3)
      const issue3Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: tempTokens[2],
      });
      assert.status(issue3Res, 201);
      const issue3Data = getData<{ token: string }>(issue3Res);

      const claim3Res = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: clientToken,
        body: { token: issue3Data.token },
      });
      if (claim3Res.status !== 200 && claim3Res.status !== 201) {
        throw new Error(`Pair with stylist 3 failed: ${claim3Res.status}`);
      }

      // 6. Pair client with stylist 4 → should FAIL (PAIRING_LIMIT_REACHED)
      const issue4Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: tempTokens[3],
      });
      // Issue might succeed (creates token), but claim should fail
      if (issue4Res.status === 201) {
        const issue4Data = getData<{ token: string }>(issue4Res);
        const claim4Res = await apiCall({
          endpoint: '/api/v1/pairing/claim-session',
          method: 'POST',
          token: clientToken,
          body: { token: issue4Data.token },
        });
        if (claim4Res.status < 400) {
          throw new Error(
            `Expected 4th pairing to be rejected (limit 3), got ${claim4Res.status}`
          );
        }
      } else if (issue4Res.status < 400) {
        throw new Error(
          `Expected 4th issue to fail or claim to fail, got issue status ${issue4Res.status}`
        );
      }

      // 7. Revoke pairing with stylist 1 (stylist revokes client access)
      // We need client's user_id — get from session
      const clientSessionRes = await apiCall({
        endpoint: '/api/v1/session/get-current',
        method: 'GET',
        token: clientToken,
      });
      const clientSessionData =
        getData<Record<string, unknown>>(clientSessionRes);
      const clientUserId = clientSessionData.id as string;

      await apiCall({
        endpoint: '/api/v1/pairing/revoke-access',
        method: 'POST',
        token: tempTokens[0],
        body: { target_user_id: clientUserId },
      });

      // 8. Try pairing with stylist 4 again → should succeed now (slot freed)
      const issue4RetryRes = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: tempTokens[3],
      });
      assert.status(issue4RetryRes, 201);
      const issue4RetryData = getData<{ token: string }>(issue4RetryRes);

      const claim4RetryRes = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: clientToken,
        body: { token: issue4RetryData.token },
      });
      if (claim4RetryRes.status !== 200 && claim4RetryRes.status !== 201) {
        throw new Error(
          `Stylist 4 retry claim failed after revoke: ${claim4RetryRes.status}`
        );
      }

      // 9. Verify: client has exactly 3 pairings (stylists 2, 3, 4)
      // This is implicitly verified by the fact that claim 4 succeeded after revoking 1
    } finally {
      // Cleanup: get client user_id for revoke
      const clientSessionRes = await apiCall({
        endpoint: '/api/v1/session/get-current',
        method: 'GET',
        token: clientToken,
      }).catch(() => null);
      const clientUserId = clientSessionRes
        ? (getData<Record<string, unknown>>(clientSessionRes).id as string)
        : null;

      // Revoke all pairings (stylist revokes client)
      for (const stylistToken of tempTokens) {
        if (clientUserId) {
          await apiCall({
            endpoint: '/api/v1/pairing/revoke-access',
            method: 'POST',
            token: stylistToken,
            body: { target_user_id: clientUserId },
          }).catch(() => {});
        }
      }
      // Delete temp users
      for (const userId of tempUserIds) {
        await apiCall({
          endpoint: '/api/v1/admin/user/delete/any',
          method: 'POST',
          token: adminToken,
          body: { id: userId },
        }).catch(() => {});
      }
    }
  });

  // ── C4: hourly share brake, per (client → stylist) pair ──
  // DECISION (nie usuwaj tego komentarza) — owner 2026-10-09:
  // Do tego dnia test dowodził czegoś, co okazało się wadą: JEDNA klientka pętlą
  // „utwórz, dodaj zdjęcie, udostępnij, zamknij” zjadała cały godzinny budżet
  // stylistki z jej planu (Free 5), a szósta wysyłka dostawała 429. Tyle że po
  // niej 429 dostawała też każda INNA klientka tej stylistki. Hamulec liczy się
  // teraz per para i jest stałą platformy (DECISION przy
  // SESSION_SHARES_PER_PAIR_PER_HOUR w session-container-share.operation.ts), więc
  // test mierzy dwie rzeczy naraz:
  //  1. nadawczyni zostaje zatrzymana po swojej dozwolonej liczbie wysyłek;
  //  2. druga klientka tej samej stylistki wysyła w tej samej minucie bez
  //     przeszkód (to jest właściwa regresja: „niewinna nie obrywa”).
  // `close()` po każdej wysyłce zwalnia żywy slot pary, a `shared_at` zostaje,
  // więc licznik godzinowy rośnie. Stylistka i obie klientki są świeże: budżet
  // jest kroczącym oknem godziny, więc konta współdzielone psułyby drugi
  // przebieg pakietu w tej samej godzinie.
  await test('C4_SHARE_BRAKE_IS_PER_PAIR', async () => {
    const adminToken = await getAdminToken();
    const SHARES_PER_PAIR_PER_HOUR = 3; // SESSION_SHARES_PER_PAIR_PER_HOUR (web-1)
    const stamp = Date.now();
    const tempUserIds: string[] = [];
    const clientUserIds: string[] = [];
    const openSessions: Array<{ token: string; sessionId: string }> = [];
    let galleryRecordId: string | null = null;

    const login = async (email: string) => {
      const res = await apiCall({
        endpoint: '/api/auth/dev-login',
        method: 'POST',
        body: { email },
      });
      assert.status(res, 200);
      const id = getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(res).id;
      tempUserIds.push(id);
      return { id, token: extractSessionToken(res) };
    };

    const stylist = await login(`temp-c4-stylist-${stamp}@example.com`);
    const stylistToken = stylist.token;
    const stylistOnboardRes = await apiCall({
      endpoint: '/api/v1/user/onboard-stylist',
      method: 'POST',
      token: stylistToken,
      body: { display_name: 'QA C4 Stylist', address_city: 'Warsaw' },
    });
    if (stylistOnboardRes.status !== 200 && stylistOnboardRes.status !== 201) {
      throw new Error(`C4 stylist onboard failed: ${stylistOnboardRes.status}`);
    }

    // A fresh CLIENT paired with the C4 stylist (FREE allows two of them).
    const makePairedClient = async (label: string): Promise<string> => {
      const client = await login(`temp-c4-${label}-${stamp}@example.com`);
      clientUserIds.push(client.id);
      const onboardRes = await apiCall({
        endpoint: '/api/v1/user/onboard-client',
        method: 'POST',
        token: client.token,
        body: {},
      });
      if (onboardRes.status !== 200 && onboardRes.status !== 201) {
        throw new Error(`C4 client onboard failed: ${onboardRes.status}`);
      }
      const issueRes = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: stylistToken,
      });
      assert.status(issueRes, 201);
      const claimRes = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: client.token,
        body: { token: getData<{ token: string }>(issueRes).token },
      });
      if (claimRes.status !== 200 && claimRes.status !== 201) {
        throw new Error(`Claim failed (${label}): ${claimRes.status}`);
      }
      return client.token;
    };

    // create → add-photo → share; returns the share response and the session.
    const shareOnce = async (clientToken: string, recordId: string) => {
      const containerRes = await apiCall({
        endpoint: '/api/v1/session-container/create',
        method: 'POST',
        token: clientToken,
        body: {} satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['REQUEST'],
      });
      if (containerRes.status !== 201) {
        throw new Error(
          `Session container create failed: ${containerRes.status}`
        );
      }
      const sessionId =
        getData<SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CREATE']['RESPONSE']>(
          containerRes
        ).session.id;
      openSessions.push({ token: clientToken, sessionId });
      const addPhotoRes = await apiCall({
        endpoint: '/api/v1/session-container/add-photo',
        method: 'POST',
        token: clientToken,
        body: {
          session_id: sessionId,
          gallery_record_id: recordId,
        } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_ADD_PHOTO']['REQUEST'],
      });
      // BDX W2.5: add-photo is a create → 201 (was 200).
      if (addPhotoRes.status !== 201) {
        throw new Error(
          `Add photo failed: ${addPhotoRes.status}, event ${getEvent(addPhotoRes)}`
        );
      }
      const shareRes = await apiCall({
        endpoint: '/api/v1/session-container/share',
        method: 'POST',
        token: clientToken,
        body: {
          session_id: sessionId,
        } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_SHARE']['REQUEST'],
      });
      return { shareRes, sessionId };
    };

    const closeSession = (clientToken: string, sessionId: string) =>
      apiCall({
        endpoint: '/api/v1/session-container/close',
        method: 'POST',
        token: clientToken,
        body: {
          session_id: sessionId,
        } satisfies SESSION_CONTAINER_DTO_API_V1['SESSION_CONTAINER_CLOSE']['REQUEST'],
      });

    try {
      const colorsRes = await apiCall({
        endpoint: '/api/v1/gallery/colors',
        token: stylistToken,
      });
      const colors = getData<Array<{ id: string }>>(colorsRes);
      const traitsRes = await apiCall({
        endpoint: '/api/v1/gallery/traits',
        token: stylistToken,
      });
      const traits = getData<Array<{ id: string }>>(traitsRes);
      if (!colors.length || !traits.length)
        throw new Error('No colors or traits in DB');

      // ONE gallery record (stylist-owned), reused by every session of the test.
      const galleryRes = await apiCall({
        endpoint: '/api/v1/gallery/create-gallery-record',
        method: 'POST',
        token: stylistToken,
        body: {
          // Kształt, który przepuszcza walidator adresu zasobu (od s34 tylko
          // `res.cloudinary.com/<chmura>/image/upload/…`); unikalny, więc bramka
          // własności pliku widzi go jako niczyj.
          asset_url: `https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/smoke/c4-share-brake-${stamp}.jpg`,
          color_ids: [colors[0].id],
          trait_ids: [traits[0].id],
          nail_length: 'MEDIUM',
        },
      });
      if (galleryRes.status !== 201) {
        throw new Error(`Gallery record creation failed: ${galleryRes.status}`);
      }
      const recordId = getData<{ gallery_record_id: string }>(
        galleryRes
      ).gallery_record_id;
      galleryRecordId = recordId;

      const floodingClientToken = await makePairedClient('flood');
      const quietClientToken = await makePairedClient('quiet');

      // 1. The sender: her allowed shares pass, the next one is stopped.
      for (let i = 1; i <= SHARES_PER_PAIR_PER_HOUR; i++) {
        const { shareRes, sessionId } = await shareOnce(
          floodingClientToken,
          recordId
        );
        if (shareRes.status >= 400) {
          throw new Error(
            `Share ${i} failed unexpectedly: status ${shareRes.status}, event ${getEvent(shareRes)}`
          );
        }
        await closeSession(floodingClientToken, sessionId);
      }
      const { shareRes: stoppedRes } = await shareOnce(
        floodingClientToken,
        recordId
      );
      assert.status(stoppedRes, 429);
      assert.equals(
        getEvent(stoppedRes),
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED,
        'the share above the per-pair hourly brake must be rejected with SESSION_CONTAINER_SHARE_QUOTA_EXCEEDED'
      );

      // 2. Somebody else's flood is not her problem.
      const { shareRes: quietRes } = await shareOnce(
        quietClientToken,
        recordId
      );
      if (quietRes.status >= 400) {
        throw new Error(
          `A second client of the same stylist was stopped by another client's shares: status ${quietRes.status}, event ${getEvent(quietRes)}`
        );
      }
    } finally {
      for (const { token, sessionId } of openSessions) {
        await closeSession(token, sessionId).catch(() => {});
      }
      if (galleryRecordId) {
        await apiCall({
          endpoint: '/api/v1/gallery/delete-record',
          method: 'POST',
          token: stylistToken,
          body: { gallery_record_id: galleryRecordId },
        }).catch(() => {});
      }
      for (const target_user_id of clientUserIds) {
        await apiCall({
          endpoint: '/api/v1/pairing/revoke-access',
          method: 'POST',
          token: stylistToken,
          body: { target_user_id },
        }).catch(() => {});
      }
      // Delete every temp identity: without it each run leaves a stylist with a
      // gallery record and two pairs in the dev database.
      for (const id of tempUserIds) {
        await apiCall({
          endpoint: '/api/v1/admin/user/delete/any',
          method: 'POST',
          token: adminToken,
          body: { id },
        }).catch(() => {});
      }
    }
  });

  // ── C5: Pairing-quota-limit (FREE plan: max 2 paired clients per stylist) ──
  await test('C5_PAIRING_QUOTA_LIMIT', async () => {
    const stylistToken = await getStylistToken();
    const adminToken = await getAdminToken();
    const tempUserIds: string[] = [];
    const tempTokens: string[] = [];

    try {
      // 1. Create 3 temp client users
      for (let i = 1; i <= 3; i++) {
        const email = `temp-qa-c5-${i}-${Date.now()}@example.com`;
        const loginRes = await apiCall({
          endpoint: '/api/auth/dev-login',
          method: 'POST',
          body: { email },
        });
        assert.status(loginRes, 200);
        const loginData =
          getData<USER_DTO_API_V1['DEV_LOGIN']['RESPONSE']>(loginRes);
        const loginToken = extractSessionToken(loginRes);
        tempUserIds.push(loginData.id);
        tempTokens.push(loginToken);

        // 2. Onboard each as client
        const onboardRes = await apiCall({
          endpoint: '/api/v1/user/onboard-client',
          method: 'POST',
          token: loginToken,
          body: { display_name: `QA C5 Client ${i}` },
        });
        if (onboardRes.status !== 200 && onboardRes.status !== 201) {
          throw new Error(`Client onboard ${i} failed: ${onboardRes.status}`);
        }
      }

      // 3. Pair client 1 with stylist → should succeed
      const issue1Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: stylistToken,
      });
      assert.status(issue1Res, 201);
      const issue1Data = getData<{ token: string }>(issue1Res);

      const claim1Res = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: tempTokens[0],
        body: { token: issue1Data.token },
      });
      if (claim1Res.status !== 200 && claim1Res.status !== 201) {
        throw new Error(`Client 1 claim failed: ${claim1Res.status}`);
      }

      // 4. Pair client 2 with stylist → should succeed
      const issue2Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: stylistToken,
      });
      assert.status(issue2Res, 201);
      const issue2Data = getData<{ token: string }>(issue2Res);

      const claim2Res = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: tempTokens[1],
        body: { token: issue2Data.token },
      });
      if (claim2Res.status !== 200 && claim2Res.status !== 201) {
        throw new Error(`Client 2 claim failed: ${claim2Res.status}`);
      }

      // 5. Pair client 3 with stylist → should FAIL (limit: 2 paired clients)
      const issue3Res = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: stylistToken,
      });
      // Issue might succeed (creates token), but claim should fail
      if (issue3Res.status === 201) {
        const issue3Data = getData<{ token: string }>(issue3Res);
        const claim3Res = await apiCall({
          endpoint: '/api/v1/pairing/claim-session',
          method: 'POST',
          token: tempTokens[2],
          body: { token: issue3Data.token },
        });
        if (claim3Res.status < 400) {
          throw new Error(
            `Expected 3rd pairing to be rejected (limit 2), got ${claim3Res.status}`
          );
        }
      } else if (issue3Res.status < 400) {
        throw new Error(
          `Expected 3rd issue to fail or claim to fail, got issue status ${issue3Res.status}`
        );
      }
      // If issue itself failed with 4xx, that's also acceptable (limit enforced at issue)

      // 6. Revoke client 1's access
      await apiCall({
        endpoint: '/api/v1/pairing/revoke-access',
        method: 'POST',
        token: stylistToken,
        body: { target_user_id: tempUserIds[0] },
      });

      // 7. Try client 3 again → should succeed now (slot freed)
      const issue3RetryRes = await apiCall({
        endpoint: '/api/v1/pairing/issue-session',
        method: 'POST',
        token: stylistToken,
      });
      assert.status(issue3RetryRes, 201);
      const issue3RetryData = getData<{ token: string }>(issue3RetryRes);

      const claim3RetryRes = await apiCall({
        endpoint: '/api/v1/pairing/claim-session',
        method: 'POST',
        token: tempTokens[2],
        body: { token: issue3RetryData.token },
      });
      if (claim3RetryRes.status !== 200 && claim3RetryRes.status !== 201) {
        throw new Error(
          `Client 3 retry claim failed after revoke: ${claim3RetryRes.status}`
        );
      }
    } finally {
      // Cleanup: revoke all pairings
      for (const userId of tempUserIds) {
        await apiCall({
          endpoint: '/api/v1/pairing/revoke-access',
          method: 'POST',
          token: stylistToken,
          body: { target_user_id: userId },
        }).catch(() => {});
      }
      // Delete temp users
      for (const userId of tempUserIds) {
        await apiCall({
          endpoint: '/api/v1/admin/user/delete/any',
          method: 'POST',
          token: adminToken,
          body: { id: userId },
        }).catch(() => {});
      }
    }
  });
}
