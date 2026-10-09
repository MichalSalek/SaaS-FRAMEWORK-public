import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { getPrimaryDatabaseAvailability } from '@app/db/db-availability.state';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withPublicHandler } from '@app/http/define-raw-handler';

// DECISION (nie usuwaj tego komentarza):
// Public no-auth endpoint dla status page + pasywnego DB monitora Better Stack.
// Sanitized: NIE eksponuje vendor names (Neon/Render/Mailgun), error details, latency precise,
// user counts, connection strings, internal hostnames. Zwraca tylko: database up|down, api up|down,
// uptime_seconds (sekundy od uruchomienia procesu), ts (ISO timestamp).
// Rate limited per IP via STRICT_ENDPOINTS — bot DDOS protection (50 req/10s).
// Nie odpytuje DB ani dostawców. Stan pochodzi z faktycznego użycia głównej puli.
// Admin /health (auth required) ma full diagnostic dla operatora.
// Namespace /internal/ zachowany dla spójności z track-crawler mimo braku secret auth —
// ten endpoint jest celowo public (status page requirement). Patrz routing.config.ts DECISION.
//
// BDX W2.3: owinięty w `withPublicHandler({ cors: false })` — S2S/public probe NIE jest
// wołany z browsera, więc Origin allow-list tylko dodałaby failure modes. Wrapper daje
// timing/error-scaffold; rate-limit zostaje jawny w `handle` (przed którym ustawiamy
// Cache-Control + method gate, by zachować dokładną kolejność odpowiedzi).
//
// BDX W6.1: correlation. `withPublicHandler` owija handler w
// `withTimingNextHandlerMiddleware`, które wchodzi w `runWithRequestContext` (ALS) i
// ustawia nagłówek X-Request-Id PRZED `handle` — ta ścieżka ma więc correlationId w logach
// bez re-implementacji. Statusy 405/200 już używają APP_EVENTS.INFO.* / QUERIES.* (F5),
// nie raw-stringów. Sam odczyt stanu nigdy nie budzi Neona.

/**
 * Public health endpoint for the product status page and Better Stack monitors.
 *
 * Security guarantees:
 * - No auth required (uptime monitors need public access)
 * - Sanitized response: no vendor names, no error messages, no latency precision, no counts
 * - Rate limited (STRICT: 50 req / 10s per IP)
 * - Cache-Control: no-store (state changes must be visible to incident recovery)
 * - GET/HEAD only (HEAD zwraca te same nagłówki bez ciała — dla monitorów uptime)
 * - DB-free: reads only process-local last-observed pool state
 */
export default withPublicHandler({
  allowedMethods: ['GET'],
  cors: false,
  // Rate limit stays inside `handle` so it runs AFTER the Cache-Control header +
  // method gate, preserving the exact original response ordering.
  rateLimit: false,
  handle: async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');

    // GET/HEAD only — reszta metod dostaje 405 (nie 404, tu nie ma czego maskować).
    // BDX F5: raw 'METHOD_NOT_ALLOWED' string → APP_EVENTS SSOT (ACCESS_DENIED_INFO =
    // the canonical method/access-reject event used by the other raw auth-edge handlers).
    //
    // DECISION (nie usuwaj tego komentarza):
    // HEAD = GET bez ciała i dokładnie to wysyła spora część monitorów uptime (Better Stack
    // „HEAD", `curl -I`) — wcześniej dostawały 405 i raportowały fałszywy DOWN. HEAD celowo
    // NIE trafia do `allowedMethods`: kernelowy `HTTPMethod` modeluje tylko czasowniki CQRS
    // (get/post/patch/delete) i karmi rejestr metod, więc bramka metody żyje tutaj.
    // 405 niesie `Allow`, bo bez niego odpowiedź łamie RFC 9110 i nie mówi klientowi,
    // czym ma ponowić.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res
        .status(405)
        .json({ event: APP_EVENTS.INFO.APPLICATION.ACCESS_DENIED_INFO });
      return;
    }

    // Rate limit — STRICT_ENDPOINTS bucket (50 req / 10s per IP).
    // Legitimate monitor: 1 ping / 1-5 min. Bot scraper would hit limit quickly.
    if (!withRateLimitCheck(req, res)) {
      return;
    }

    // HEAD kończy się tu: te same nagłówki co GET, zero bajtów ciała (RFC 9110 §9.3.2).
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(200).end();
      return;
    }

    const databaseAvailability = getPrimaryDatabaseAvailability();
    const databaseStatus: 'up' | 'down' =
      databaseAvailability.status === 'up' ? 'up' : 'down';

    // API is always 'up' if this code is executing — the request reached the handler.
    const apiStatus: 'up' | 'down' = 'up';

    // Uptime in whole seconds — not a fingerprint risk (no precise timing).
    const uptime_seconds = Math.round(process.uptime());

    res.status(200).json({
      event: APP_EVENTS.QUERIES.APPLICATION.INTERNAL_HEALTH_PUBLIC,
      data: {
        database: databaseStatus,
        api: apiStatus,
        uptime_seconds,
        ts: new Date().toISOString(),
      },
    });
  },
});
