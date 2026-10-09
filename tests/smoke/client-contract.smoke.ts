/**
 * Client domain contract smoke tests
 *
 * Contract tests for client endpoints not covered by existing smoke tests.
 * Tests auth (401), RBAC (403), and body validation (400) boundaries.
 *
 * Covered endpoints:
 * - CLIENT_GET_CONTACT_FOR_STYLIST (auth + RBAC + validation + HAPPY PATH)
 *
 * DLACZEGO HAPPY PATH TU JEST (nie usuwaj go „bo negatywy wystarczą"):
 * do 2026-09-10 ten endpoint miał WYŁĄCZNIE trzy negatywy poniżej — a każdy
 * z nich wraca 401/403/400 PRZED transakcją, więc realna ścieżka odczytu (tx +
 * `lockActivePair` + read kontaktu) nie była wykonywana ANI RAZU. Kiedy
 * zagnieżdżony fragment `Prisma.sql` w tagowanym `$queryRaw` zaczął lecieć do
 * Postgresa jako bind parametr (42601 → 500 na produkcji), suite świeciła się na
 * zielono: negatywy zawracały wcześniej, a testy jednostkowe mockują `$queryRaw`.
 * Pokrycie samymi negatywami, które zwierają obwód przed właściwą pracą, to
 * pokrycie POZORNE. Strażnik tej klasy: `npm run audit:prisma-nested-sql`.
 *
 * Stan budowany WYŁĄCZNIE przez API (parytet z resztą smoke — zero SQL).
 */

import { test, apiCall, getData, assert } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import type { TestContext } from './_test-utils';
import type { CLIENT_DTO_API_V1 } from '@kernel/models/client/client.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';

/**
 * Kontakt ustawiany na czas testu i przywracany w `finally`. Wartości bez
 * znaków, które `sanitizeInput` escape'uje (`< > " ' /`) — inaczej porównanie
 * odczytu z zapisem myliłoby zapis kolumny z ujawnieniem kontaktu.
 */
const PROBE_PHONE = '+48222333444';
const PROBE_EMAIL = 'contract-smoke-client@example.com';

export async function runClientContractTests(ctx: TestContext): Promise<void> {
  // ── CLIENT_GET_CONTACT_FOR_STYLIST ──

  await test('CLIENT_CONTACT_FOR_STYLIST_REQUIRES_AUTH', async () => {
    const res = await apiCall({
      endpoint:
        '/api/v1/client/contact/get-for-stylist?client_user_id=fake_user_id',
      method: 'GET',
    });
    assert.status(res, 401);
  });

  await test('CLIENT_CONTACT_FOR_STYLIST_REQUIRES_STYLIST', async () => {
    const res = await apiCall({
      endpoint:
        '/api/v1/client/contact/get-for-stylist?client_user_id=fake_user_id',
      method: 'GET',
      token: ctx.clientToken,
    });
    assert.status(res, 403);
  });

  await test('CLIENT_CONTACT_FOR_STYLIST_VALIDATES_BODY', async () => {
    // No client_user_id in query — handler returns 400
    const res = await apiCall({
      endpoint: '/api/v1/client/contact/get-for-stylist',
      method: 'GET',
      token: ctx.stylistToken,
    });
    assert.status(res, 400);
  });

  // ── HAPPY PATH: para ACTIVE → stylistka widzi kontakt klientki ──
  let stylistAccountId = '';
  let originalContact: CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE'] | null =
    null;
  let contactOverwritten = false;

  try {
    const pair = await ensureActivePair(ctx);
    stylistAccountId = pair.stylistAccountId;

    // Zapamiętujemy kontakt sprzed testu — inne suity czytają ten sam wiersz.
    const before = await apiCall({
      endpoint: ROUTES_API.CLIENT_GET_PROFILE,
      method: 'POST',
      token: ctx.clientToken,
      body: {},
    });
    if (before.status === 200) {
      originalContact =
        getData<CLIENT_DTO_API_V1['CLIENT_GET_PROFILE']['RESPONSE']>(before);
    }

    const seed = await apiCall({
      endpoint: ROUTES_API.CLIENT_UPDATE_CONTACT,
      method: 'POST',
      token: ctx.clientToken,
      body: {
        contact_phone: PROBE_PHONE,
        contact_email: PROBE_EMAIL,
      } satisfies CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
    });
    if (seed.status !== 200) {
      throw new Error(`seed client contact failed: ${seed.status}`);
    }
    contactOverwritten = true;

    await test('CLIENT_CONTACT_FOR_STYLIST_RETURNS_PAIRED_CONTACT', async () => {
      const res = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CONTACT_FOR_STYLIST}?client_user_id=${encodeURIComponent(pair.clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      // 500 tutaj = transakcja odczytu jest zepsuta (to był objaw 2026-09-10).
      assert.status(res, 200);
      const data =
        getData<CLIENT_DTO_API_V1['CLIENT_GET_CONTACT_FOR_STYLIST']['RESPONSE']>(
          res
        );
      // Porównanie z ZAPISANĄ wartością, nie samo `hasProperty`: dowodzi, że
      // odczyt przeszedł przez lock i wiersz klientki, a nie oddał pustego DTO.
      assert.equals(
        data.contact_phone,
        PROBE_PHONE,
        'stylist must see the phone the paired client saved'
      );
      assert.equals(
        data.contact_email,
        PROBE_EMAIL,
        'stylist must see the email the paired client saved'
      );
      // client_name = `users.name` klientki. TEST_USERS_CONFIG.CLIENT nie ma
      // `display_name` (SSOT), więc pusty string jest tu LEGALNY — sprawdzamy
      // typ i obecność pola, a dowodem odczytu wiersza są telefon i e-mail wyżej.
      assert.hasProperty(data, 'client_name');
      assert.equals(
        typeof data.client_name,
        'string',
        'client_name must be a string'
      );
    });

    // Ta sama transakcja z drugiej strony: po rozparowaniu odczyt MUSI zamilknąć.
    // Bez tego „200" wyżej nie dowodzi, że bramka pary w ogóle działa.
    await revokePairQuietly(ctx, stylistAccountId);
    stylistAccountId = '';

    await test('CLIENT_CONTACT_FOR_STYLIST_STOPS_AFTER_REVOKE', async () => {
      const res = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CONTACT_FOR_STYLIST}?client_user_id=${encodeURIComponent(pair.clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.equals(
        res.status >= 400 && res.status < 500,
        true,
        `revoked pairing must stop the contact reveal with 4xx, got ${res.status}`
      );
    });
  } finally {
    if (contactOverwritten && originalContact) {
      await apiCall({
        endpoint: ROUTES_API.CLIENT_UPDATE_CONTACT,
        method: 'POST',
        token: ctx.clientToken,
        body: {
          contact_phone: originalContact.contact_phone,
          contact_email: originalContact.contact_email,
        } satisfies CLIENT_DTO_API_V1['CLIENT_UPDATE_CONTACT']['REQUEST'],
      }).catch(() => {
        /* cleanup nie może przykryć błędu właściwego testu */
      });
    }
    await revokePairQuietly(ctx, stylistAccountId);
  }
}
