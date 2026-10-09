/**
 * Visit + CRM domain smoke tests (karta klientki)
 *
 * Domyka lukę pokryciową: 8 tras, które do tej pory nie miały ŻADNEGO testu,
 * a są wołane z frontu (karta klientki stylistki).
 *   GET_CLIENT_VISITS, CREATE_MANUAL_VISIT, UPDATE_VISIT_NOTE,
 *   ADD_VISIT_RESULT_PHOTO, REMOVE_VISIT_RESULT_PHOTO, DELETE_MANUAL_VISIT,
 *   CLIENT_GET_CRM_NOTE, CLIENT_UPSERT_CRM_NOTE
 *
 * Te testy złapałyby regresje w:
 *   - bramce planu (`can_view_history`): FREE nie widzi historii, ale GET zwraca
 *     200 z `historyAccess.isLocked`, a WRITE zwraca 403 CLIENT_CARD_PLAN_LOCKED
 *   - bramce parowania (wizyta/notatka wymagają pary ACTIVE)
 *   - izolacji STYLIST-only (klientka nie ma dostępu do żadnej z tych tras)
 *   - normalizacji notatek (same spacje -> null) i kształcie DTO wizyty
 *   - idempotencji kasowania (drugie DELETE = 4xx, nigdy 5xx)
 *
 * Stan budowany WYŁĄCZNIE przez API (parytet z resztą smoke — zero SQL).
 * Plan stylistki jest podnoszony przez admina i PRZYWRACANY na FREE w `finally`,
 * bo `TEST_USERS_CONFIG.STYLIST.pricing_plan` = FREE jest SSOT dla innych suit.
 */

import { test, apiCall, getData, getEvent, assert } from './_test-utils';
import { ensureActivePair, revokePairQuietly } from './_pair-fixture';
import type { TestContext } from './_test-utils';
import type { VISIT_DTO_API_V1 } from '@kernel/models/visit/visit.dto';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';

/** Plan z pełną historią — bramka `can_view_history` musi przepuścić. */
const HISTORY_PLAN = 'PRO_PLUS';
/** Plan bazowy test-stylistki (SSOT: TEST_USERS_CONFIG) — przywracany na końcu. */
const BASE_PLAN = 'FREE';

/** Walidator wymaga prefiksu Cloudinary — dowolna inna domena = 400. */
const CLOUDINARY_ASSET =
  'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1/smoke-visit-photo.jpg';

type AdminUserRow = { id: string; email: string };

const findUserIdByEmail = async (
  adminToken: string,
  email: string
): Promise<string> => {
  const response = await apiCall({
    endpoint: `${ROUTES_API.ADMIN_GET_USERS_PAGINATED}?search=${encodeURIComponent(email)}&take=5`,
    method: 'GET',
    token: adminToken,
  });
  assert.status(response, 200);
  const data = getData<{ records: AdminUserRow[] }>(response);
  const row = data.records.find(r => r.email === email);
  if (!row) {
    throw new Error(`Admin search did not return user ${email}`);
  }
  return row.id;
};

const changePlan = async (
  adminToken: string,
  userId: string,
  plan: string
): Promise<void> => {
  const response = await apiCall({
    endpoint: ROUTES_API.ADMIN_CHANGE_PRICING_PLAN,
    method: 'POST',
    token: adminToken,
    body: { id: userId, pricing_plan: plan },
  });
  if (response.status !== 200 && response.status !== 204) {
    throw new Error(
      `changePlan(${plan}) failed: ${response.status} ${getEvent(response)}`
    );
  }
};

export async function runVisitCrmTests(ctx: TestContext): Promise<void> {
  let stylistUserId = '';
  let clientUserId = '';
  let stylistAccountId = '';
  let visitId = '';
  let photoId = '';
  let planRaised = false;

  // DECISION (nie usuwaj tego komentarza) — S113, 2026-09-10:
  // Przygotowanie fikstury MUSI być opakowane w `test()`. Wcześniej
  // `ensureActivePair` i `findUserIdByEmail` stały nagie wewnątrz `try { } finally { }`
  // BEZ `catch`, więc jedno 403 z parowania wylatywało z tej funkcji, przelatywało
  // przez `await runVisitCrmTests(ctx)` w `run-smoke-tests.ts` i WYWRACAŁO CAŁY
  // PAKIET: wszystko poniżej zostawało nieprzetestowane, bez podsumowania i bez
  // jednej informacji, czego dotyczyła awaria. Fikstura, która potrafi zabić pakiet,
  // jest gorsza niż test, który potrafi się wywalić — dlatego jej porażka jest teraz
  // JEDNYM czerwonym testem, a reszta pakietu jedzie dalej.
  // (403 z `issue-session` znaczy jedno z dwóch: „to nie stylistka" albo „sufit par",
  // stąd treść odpowiedzi w wyjątku `ensureActivePair`.)
  let fixtureReady = false;
  await test('VISIT_CRM_FIXTURE', async () => {
    stylistUserId = await findUserIdByEmail(
      ctx.adminToken,
      'test-stylist-main@example.com'
    );
    const pair = await ensureActivePair(ctx);
    clientUserId = pair.clientUserId;
    stylistAccountId = pair.stylistAccountId;
    fixtureReady = true;
  });
  if (!fixtureReady) {
    return;
  }

  try {

    // ── Bramka planu na FREE ──────────────────────────────────────────────
    // DECISION-parity: READ nie jest twardym 403 — zwraca 200 z pustą listą i
    // `historyAccess.isLocked`, żeby UI mogło narysować upsell zamiast błędu.
    await test('GET_CLIENT_VISITS_LOCKED_ON_FREE', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.GET_CLIENT_VISITS}?client_user_id=${encodeURIComponent(clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE']>(response);
      assert.hasProperty(data, 'historyAccess');
      assert.equals(
        data.historyAccess.canViewHistory,
        false,
        'FREE must not unlock visit history'
      );
      assert.equals(data.historyAccess.isLocked, true, 'FREE must be locked');
      assert.equals(data.visits.length, 0, 'locked plan returns no visits');
    });

    // WRITE na zablokowanym tierze = twarde 403 (nie cicha akceptacja).
    await test('CREATE_MANUAL_VISIT_FORBIDDEN_ON_FREE', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.CREATE_MANUAL_VISIT,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          client_user_id: clientUserId,
          visit_date: new Date().toISOString(),
        },
      });
      assert.status(response, 403);
    });

    await test('CLIENT_GET_CRM_NOTE_FORBIDDEN_ON_FREE', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CRM_NOTE}?client_user_id=${encodeURIComponent(clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.status(response, 403);
    });

    // ── Podniesienie planu (plan czytany z bazy per request — bez re-loginu) ──
    await changePlan(ctx.adminToken, stylistUserId, HISTORY_PLAN);
    planRaised = true;

    // ── Wizyty: pełny cykl życia ──────────────────────────────────────────
    await test('CREATE_MANUAL_VISIT', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.CREATE_MANUAL_VISIT,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          client_user_id: clientUserId,
          visit_date: new Date().toISOString(),
          service_note: 'Smoke: żel + french',
        },
      });
      assert.status(response, 201);
      const data =
        getData<VISIT_DTO_API_V1['CREATE_MANUAL_VISIT']['RESPONSE']>(response);
      assert.hasProperty(data, 'visit');
      assert.equals(data.visit.source, 'MANUAL', 'manual create => source MANUAL');
      assert.equals(data.visit.clientUserId, clientUserId);
      assert.equals(data.visit.serviceNote, 'Smoke: żel + french');
      assert.equals(
        Array.isArray(data.visit.resultPhotos),
        true,
        'resultPhotos must be an array even when empty'
      );
      assert.equals(data.visit.sessionId, null, 'manual visit has no sessionId');
      visitId = data.visit.id;
    });

    // Data z przyszłości: wizyta jest zdarzeniem przeszłym (walidator ma
    // tolerancję 24h na strefy czasowe, więc celujemy dobę dalej).
    await test('CREATE_MANUAL_VISIT_REJECTS_FUTURE_DATE', async () => {
      const future = new Date(Date.now() + 5 * 24 * 60 * 60 * 1000);
      const response = await apiCall({
        endpoint: ROUTES_API.CREATE_MANUAL_VISIT,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          client_user_id: clientUserId,
          visit_date: future.toISOString(),
        },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `future visit_date must be rejected, got ${response.status}`
      );
    });

    // Data spoza zakresu PostgreSQL nie może dolecieć do sterownika jako 500.
    await test('CREATE_MANUAL_VISIT_REJECTS_OUT_OF_RANGE_DATE', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.CREATE_MANUAL_VISIT,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          client_user_id: clientUserId,
          visit_date: '-9999-01-01T00:00:00.000Z',
        },
      });
      assert.equals(
        response.status >= 400 && response.status < 500,
        true,
        `out-of-range visit_date must be 4xx, got ${response.status}`
      );
    });

    await test('GET_CLIENT_VISITS', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.GET_CLIENT_VISITS}?client_user_id=${encodeURIComponent(clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['GET_CLIENT_VISITS']['RESPONSE']>(response);
      assert.equals(data.historyAccess.canViewHistory, true);
      assert.equals(
        data.visits.some(v => v.id === visitId),
        true,
        'created visit must appear in the list'
      );
      assert.hasProperty(data, 'nextCursor');
    });

    // Cursor spoza karty tej klientki nie może być oracle'em istnienia.
    await test('GET_CLIENT_VISITS_REJECTS_FOREIGN_CURSOR', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.GET_CLIENT_VISITS}?client_user_id=${encodeURIComponent(clientUserId)}&cursor=not-a-real-cursor`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.equals(
        response.status >= 400 && response.status < 500,
        true,
        `bogus cursor must be 4xx, got ${response.status}`
      );
    });

    await test('UPDATE_VISIT_NOTE', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.UPDATE_VISIT_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId, service_note: '  hybryda, kolor 214  ' },
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['RESPONSE']>(response);
      assert.equals(
        data.visit.serviceNote,
        'hybryda, kolor 214',
        'service_note must be trimmed'
      );
    });

    await test('UPDATE_VISIT_NOTE_BLANK_CLEARS_TO_NULL', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.UPDATE_VISIT_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId, service_note: '   ' },
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['UPDATE_VISIT_NOTE']['RESPONSE']>(response);
      assert.equals(
        data.visit.serviceNote,
        null,
        'whitespace-only note must normalize to null'
      );
    });

    await test('UPDATE_VISIT_NOTE_REJECTS_OVER_MAX', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.UPDATE_VISIT_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          visit_id: visitId,
          service_note: 'x'.repeat(VISIT_CONFIG.SERVICE_NOTE_MAX + 1),
        },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `note over SERVICE_NOTE_MAX must be rejected, got ${response.status}`
      );
    });

    // ── Zdjęcia efektu ────────────────────────────────────────────────────
    await test('ADD_VISIT_RESULT_PHOTO', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.ADD_VISIT_RESULT_PHOTO,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId, asset_url: CLOUDINARY_ASSET },
      });
      assert.status(response, 201);
      const data =
        getData<VISIT_DTO_API_V1['ADD_VISIT_RESULT_PHOTO']['RESPONSE']>(
          response
        );
      assert.hasProperty(data, 'photo');
      assert.equals(data.photo.visitRecordId, visitId);
      assert.equals(data.photo.assetUrl, CLOUDINARY_ASSET);
      assert.equals(
        typeof data.photo.position,
        'number',
        'position must be numeric (kolejność w galerii wizyty)'
      );
      photoId = data.photo.id;
    });

    // asset_url spoza Cloudinary = wektor na kasowanie cudzych plików.
    await test('ADD_VISIT_RESULT_PHOTO_REJECTS_FOREIGN_HOST', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.ADD_VISIT_RESULT_PHOTO,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          visit_id: visitId,
          asset_url: 'https://evil.example.com/image/upload/v1/x.jpg',
        },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `non-Cloudinary asset_url must be rejected, got ${response.status}`
      );
    });

    await test('REMOVE_VISIT_RESULT_PHOTO', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.REMOVE_VISIT_RESULT_PHOTO,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId, photo_id: photoId },
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['REMOVE_VISIT_RESULT_PHOTO']['RESPONSE']>(
          response
        );
      assert.equals(data.success, true);
    });

    await test('REMOVE_VISIT_RESULT_PHOTO_IS_IDEMPOTENT_4XX', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.REMOVE_VISIT_RESULT_PHOTO,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId, photo_id: photoId },
      });
      assert.equals(
        response.status >= 400 && response.status < 500,
        true,
        `double remove must be 4xx (never 5xx), got ${response.status}`
      );
    });

    // ── CRM: notatka prywatna stylistki ───────────────────────────────────
    await test('CLIENT_UPSERT_CRM_NOTE', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.CLIENT_UPSERT_CRM_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          client_user_id: clientUserId,
          note: '  alergia na aceton  ',
        },
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE']>(
          response
        );
      assert.equals(data.note, 'alergia na aceton', 'CRM note must be trimmed');
      assert.equals(
        typeof data.updatedAt,
        'string',
        'updatedAt must be stamped on write'
      );
    });

    await test('CLIENT_GET_CRM_NOTE', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CRM_NOTE}?client_user_id=${encodeURIComponent(clientUserId)}`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['CLIENT_GET_CRM_NOTE']['RESPONSE']>(response);
      assert.equals(data.note, 'alergia na aceton');
    });

    await test('CLIENT_UPSERT_CRM_NOTE_BLANK_CLEARS_TO_NULL', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.CLIENT_UPSERT_CRM_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: { client_user_id: clientUserId, note: '   ' },
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['CLIENT_UPSERT_CRM_NOTE']['RESPONSE']>(
          response
        );
      assert.equals(data.note, null, 'blank CRM note must normalize to null');
    });

    await test('CLIENT_UPSERT_CRM_NOTE_REJECTS_OVER_MAX', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.CLIENT_UPSERT_CRM_NOTE,
        method: 'POST',
        token: ctx.stylistToken,
        body: {
          client_user_id: clientUserId,
          note: 'x'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 1),
        },
      });
      assert.equals(
        response.status === 400 || response.status === 422,
        true,
        `CRM note over CRM_NOTE_MAX must be rejected, got ${response.status}`
      );
    });

    // ── Izolacja: karta klientki jest STYLIST-only ────────────────────────
    // Klientka nie może zobaczyć ani wizyt, ani notatki, którą stylistka
    // zapisała O NIEJ (notatka to prywatne PII po stronie stylistki).
    await test('CLIENT_CARD_IS_STYLIST_ONLY', async () => {
      const visits = await apiCall({
        endpoint: `${ROUTES_API.GET_CLIENT_VISITS}?client_user_id=${encodeURIComponent(clientUserId)}`,
        method: 'GET',
        token: ctx.clientToken,
      });
      assert.equals(
        visits.status === 401 || visits.status === 403 || visits.status === 404,
        true,
        `client must not read visit history, got ${visits.status}`
      );

      const note = await apiCall({
        endpoint: `${ROUTES_API.CLIENT_GET_CRM_NOTE}?client_user_id=${encodeURIComponent(clientUserId)}`,
        method: 'GET',
        token: ctx.clientToken,
      });
      assert.equals(
        note.status === 401 || note.status === 403 || note.status === 404,
        true,
        `client must not read the stylist's private CRM note, got ${note.status}`
      );
    });

    // Nieznane client_user_id => brak pary => 403, nigdy 5xx i nigdy dane.
    await test('CLIENT_CARD_REJECTS_UNPAIRED_CLIENT', async () => {
      const response = await apiCall({
        endpoint: `${ROUTES_API.GET_CLIENT_VISITS}?client_user_id=nonexistent-client-id`,
        method: 'GET',
        token: ctx.stylistToken,
      });
      assert.equals(
        response.status >= 400 && response.status < 500,
        true,
        `unpaired client_user_id must be 4xx, got ${response.status}`
      );
    });

    // ── Kasowanie wizyty ──────────────────────────────────────────────────
    await test('DELETE_MANUAL_VISIT', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.DELETE_MANUAL_VISIT,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId },
      });
      assert.status(response, 200);
      const data =
        getData<VISIT_DTO_API_V1['DELETE_MANUAL_VISIT']['RESPONSE']>(response);
      assert.equals(data.success, true);
    });

    await test('DELETE_MANUAL_VISIT_IS_IDEMPOTENT_4XX', async () => {
      const response = await apiCall({
        endpoint: ROUTES_API.DELETE_MANUAL_VISIT,
        method: 'POST',
        token: ctx.stylistToken,
        body: { visit_id: visitId },
      });
      assert.equals(
        response.status >= 400 && response.status < 500,
        true,
        `double delete must be 4xx (never 5xx), got ${response.status}`
      );
      visitId = '';
    });
  } finally {
    // Przywrócenie stanu: plan bazowy + rozparowanie (inne suity zakładają
    // FREE i puste pary — patrz pre-clean w _setup.ts).
    if (planRaised && stylistUserId) {
      await changePlan(ctx.adminToken, stylistUserId, BASE_PLAN).catch(() => {
        /* raport testu i tak pokaże skutki; nie maskujemy błędu głównego */
      });
    }
    await revokePairQuietly(ctx, stylistAccountId);
  }
}
