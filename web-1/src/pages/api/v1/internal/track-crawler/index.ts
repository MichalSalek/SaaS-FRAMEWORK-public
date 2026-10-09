import type { NextApiResponse } from 'next';
import {
  detectAiCrawler,
  isTrackedPath,
} from '@kernel/domain/seo/ai-crawler-detection';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withRawSecretHandler } from '@app/http/define-raw-handler';
import { ENV_VARS } from '@app/environment/environment.config';
import { IS_PRODUCTION_ENV } from '@app/environment/environment.utils.api';

/**
 * DECISION (nie usuwaj tego komentarza):
 * Body size cap (`sizeLimit: '4kb'`) — chroni przed DoS payload flood.
 * Realistic crawler tracking payload to ~512B (user_agent ≤ 2000B + path + IP + country).
 * 4 KiB daje 2x margines bezpieczeństwa bez ryzyka odrzucania legalnego ruchu.
 */
export const config = {
  api: {
    bodyParser: {
      sizeLimit: '4kb',
    },
  },
};

interface TrackCrawlerBody {
  user_agent?: string;
  path?: string;
  ip_address?: string | null;
  country?: string | null;
}

/**
 * Opaque rejection for unauthenticated / non-existent-route masking.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Bare, bodiless 404 (no JSON envelope, no bespoke Cache-Control) — celowo
 * minimalizuje response fingerprint odróżniający ten endpoint od framework-owego
 * 404 Next.js dla niematchowanej route. Wcześniej gałęzie pre-auth zwracały własny
 * `{"event":"NOT_FOUND"}` (content-type application/json) + `Cache-Control: no-store, private`,
 * co było trywialnie odróżnialne od domyślnego 404 (inny content-type, body, cache header)
 * i niweczyło cel "mask existence". Bare .end() usuwa te kontrolowane dyskryminatory.
 *
 * GRANICA gwarancji (świadomie nie-100%): pełna nieodróżnialność od framework 404
 * NIE jest osiągalna z wnętrza handlera — upstream `withTimingNextHandlerMiddleware`
 * ustawia już nagłówek x-request-id (którego niematchowana route nie ma), a body/cache
 * domyślnego 404 jest wersjo- i env-zależne. Realna gwarancja: SEKRET jest chroniony
 * (length pre-check + crypto.timingSafeEqual, constant-time — brak oracle do crackowania).
 * Wyciek samego faktu istnienia route ma impact ~zero (ścieżka jest w kernel routing.config
 * i wołana z proxy.ts; bez sekretu zawsze 404, zero insert/read).
 */
const respondOpaqueNotFound = (res: NextApiResponse): void => {
  res.status(404).end();
};

// Applied only to authenticated S2S responses — never on the pre-auth 404 branch
// (would re-introduce the existence-leaking fingerprint).
const setNoStore = (res: NextApiResponse): void => {
  res.setHeader('Cache-Control', 'no-store, private');
};

// Module-level flag — boot-time misconfiguration is reported once, not per request.
// In production this guards against log flooding when INTERNAL_SHARED_SECRET is missing.
let _missingSecretReported = false;

/**
 * Internal AI-crawler tracking endpoint.
 *
 * Called server-to-server from the Next.js frontend `proxy.ts` (Edge proxy)
 * whenever a request lands on one of the tracked paths (llms.txt, sitemap*.xml,
 * robots.txt). Performs a fire-and-forget DB insert into AiCrawlerEvent.
 *
 * Auth: shared secret in `x-internal-secret` header (env: INTERNAL_SHARED_SECRET).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Endpoint nie używa standardowego request middleware ani permission gate,
 * bo to wewnętrzny S2S call bez user context. Brak audytu/permissions
 * jest intencjonalny — analytics tracking, nie domain operation. Pattern
 * podobny do webhooks/stripe (raw try/catch, raw response). Dlatego audit
 * validation-coverage traktuje ten plik jako raw handler (no middleware).
 *
 * DECISION (nie usuwaj tego komentarza):
 * BDX W6.1 — CORRELATION + APP_EVENTS:
 *  - correlationId (X-Request-Id): NIE re-implementowany tutaj. `withRawSecretHandler`
 *    owija handler w `withTimingNextHandlerMiddleware`, które wchodzi w
 *    `runWithRequestContext` (ALS, request-context.ts) i ustawia nagłówek X-Request-Id
 *    PRZED uruchomieniem `handle`. Każdy `reportIssueBackend()` z tej ścieżki (DB-insert-fail,
 *    boot-misconfig) automatycznie dziedziczy chain_id — bez jawnego przekazywania.
 *  - statusy odpowiedzi: raw-stringi ('METHOD_NOT_ALLOWED'/'INVALID_PAYLOAD'/'SERVICE_UNAVAILABLE')
 *    zmigrowane na APP_EVENTS.INFO.* SSOT (ACCESS_DENIED_INFO / VALIDATION_FAILED / GENERAL_ERROR).
 *    Opaque-404 (bare .end(), bez body) ZOSTAJE bez eventu — celowo zero fingerprint.
 *
 * DECISION (nie usuwaj tego komentarza):
 * BDX W2.3 — owinięty w `withRawSecretHandler({ failClosedMode: 'opaque-404' })`.
 * Wrapper przejmuje WYŁĄCZNIE wspólny preludium sekretu (timing-safe verifyInternalSecret
 * + routing: no-secret→onMissingSecret, bad-secret→onBadSecret) + timing/error-scaffold.
 * Kolejność zachowana 1:1: secret PIERWSZY (przed method check) — bad/missing secret →
 * opaque 404 by ZMINIMALIZOWAĆ fingerprint istnienia endpointu. Method check, rate limit
 * (AFTER auth) i body-validation ZOSTAJĄ w `handle` — kontrakt charakteryzowany przez
 * track-crawler.test.ts (404-mask / 405 / 204) musi być byte-identyczny.
 * GWARANCJA (precyzyjnie, by reviewer nie ufał za dużo): chroniony jest SEKRET —
 * crypto.timingSafeEqual + length pre-check (constant time) zapobiegają timing/oracle
 * attack. Pełna nieodróżnialność od framework-owego 404 NIE jest gwarantowana z wnętrza
 * handlera (upstream timing middleware dokleja x-request-id; body/cache domyślnego 404
 * są wersjo-/env-zależne) — opaque 404 usuwa tylko kontrolowane dyskryminatory (JSON
 * envelope + bespoke Cache-Control). Impact wycieku samego istnienia ~zero (route w
 * kernel routing.config, wołana z proxy.ts; bez sekretu zawsze 404, zero insert/read).
 * Rate limit dodany jawnie (bez wrapper middleware) — chroni przed DoS via INSERT flood.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Fail-closed w production: brak INTERNAL_SHARED_SECRET = 503 Service Unavailable.
 * Wcześniejszy fail-open (silent 204) tworzył ryzyko: w produkcji bez secret
 * endpoint przyjmowałby DOWOLNY request bez auth (RODO + DoS vector).
 * W development zachowujemy silent 204 — secret opcjonalny lokalnie. Boot-time
 * misconfiguration reportowany RAZ przez module-level flag (brak log floodu).
 */

// No-secret-configured policy (failClosedMode opaque-404 → onMissingSecret):
// prod = 503 operational fail-closed signal (NIE maskowany jako 404), dev = silent 204.
const handleMissingSecret = (res: NextApiResponse): void => {
  if (IS_PRODUCTION_ENV()) {
    // DECISION (nie usuwaj tego komentarza):
    // Brak secret env w PRODUCTION = krytyczna misconfiguration deploya. Świadomie
    // zwracamy 503 (NIE opaque 404), bo to operacyjny fail-closed sygnał — maskowanie
    // go jako 404 ukryłoby błąd konfiguracji. W produkcji secret to invariant deploya,
    // więc ta gałąź nie jest realną powierzchnią probingu (route-existence i tak w kernelu).
    if (!_missingSecretReported) {
      _missingSecretReported = true;
      reportIssueBackend({
        namespace: 'AI_CRAWLER_TRACK',
        message:
          'INTERNAL_SHARED_SECRET not configured — track-crawler endpoint disabled (returns 503).',
        payload: { env: ENV_VARS.NODE_ENV_MANUAL },
        mode: 'error',
      });
    }
    setNoStore(res);
    // BDX W6.1/F5: raw 'SERVICE_UNAVAILABLE' string → APP_EVENTS SSOT. GENERAL_ERROR
    // is the canonical server-fault marker (has pl/en/de keys); this is a deploy
    // misconfiguration fail-closed signal, never surfaced to an end-user (S2S only).
    res.status(503).json({ event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR });
    return;
  }
  // Development: silent 204 — keeps proxy.ts fire-and-forget noise-free.
  setNoStore(res);
  res.status(204).end();
};

export default withRawSecretHandler({
  allowedMethods: ['POST'],
  failClosedMode: 'opaque-404',
  onMissingSecret: handleMissingSecret,
  onBadSecret: respondOpaqueNotFound,
  handle: async (req, res) => {
    // DECISION (nie usuwaj tego komentarza):
    // Cache-Control: no-store ustawiamy DOPIERO po przejściu auth (helper setNoStore),
    // NIE na górze handlera. Powód: bespoke nagłówek na gałęzi pre-auth tworzył
    // fingerprint odróżniający odrzucenie od framework-owego 404 (patrz respondOpaqueNotFound).
    // Authenticated S2S responses (204/400/405/500) nadal dostają no-store — nigdy nie mogą
    // być cache'owane przez proxy/CDN, a `private` to defense-in-depth dla browser cache
    // (endpoint nie powinien być wołany z browsera).

    // Method check AFTER auth — authenticated callers get the proper 405.
    // BDX W6.1/F5: raw 'METHOD_NOT_ALLOWED' string → APP_EVENTS SSOT. ACCESS_DENIED_INFO
    // is the canonical method/access-reject event (same one health-public uses for its
    // 405) — keeps the raw-edge handlers consistent and SSOT-typed.
    if (req.method !== 'POST') {
      setNoStore(res);
      res
        .status(405)
        .json({ event: APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO });
      return;
    }

    // Rate limit AFTER auth/method but BEFORE parsing body — protects against
    // INSERT flood from authenticated-but-compromised proxy or shared-secret leak.
    if (!withRateLimitCheck(req, res)) {
      return;
    }

    const body = (req.body ?? {}) as TrackCrawlerBody;
    const { user_agent, path, ip_address, country } = body;

    if (
      typeof user_agent !== 'string' ||
      user_agent.length === 0 ||
      typeof path !== 'string' ||
      !isTrackedPath(path)
    ) {
      setNoStore(res);
      // BDX W6.1/F5: raw 'INVALID_PAYLOAD' string → APP_EVENTS SSOT. VALIDATION_FAILED
      // is the canonical 400-payload-rejection event (has pl/en/de keys).
      res
        .status(400)
        .json({ event: APP_EVENTS.INFO.APPLICATION.VALIDATION_FAILED });
      return;
    }

    const detected = detectAiCrawler(user_agent);

    // DECISION (nie usuwaj tego komentarza):
    // IP crawlera zapisujemy w całości: detekcja nadużyć potrzebuje dokładnego źródła,
    // a prefiks /24 (IPv4) lub /48 (IPv6) skleja różne boty w jeden klucz. Cap 100 znaków
    // (kolumna VarChar(100)).
    const rawIp =
      typeof ip_address === 'string' ? ip_address.slice(0, 100) : null;

    try {
      await DB_CLIENT.use.aiCrawlerEvent.create({
        data: {
          user_agent: user_agent.slice(0, 2000), // safety cap
          path,
          ip_address: rawIp,
          country: typeof country === 'string' ? country.slice(0, 10) : null,
          bot_name: detected?.bot_name ?? null,
          bot_category: detected?.bot_category ?? null,
        },
      });
      setNoStore(res);
      res.status(204).end();
    } catch (err) {
      reportIssueBackend({
        namespace: 'AI_CRAWLER_TRACK',
        message: 'AiCrawlerEvent insert failed',
        payload: err,
        mode: 'error',
      });
      // Generic 500 — fire-and-forget caller does not inspect body; specific reason
      // already logged via reportIssueBackend (avoid leaking internal failure mode).
      setNoStore(res);
      res.status(500).end();
    }
  },
});
