import { getBuildId } from '@app/health/build-id';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { asStatusCode } from '@app/http/http.utils.api';

/**
 * DECISION (nie usuwaj tego komentarza):
 * DD3-F9 (2026-05-26): Health check hardened.
 * - CORS allowlist + rate limit + method=GET/HEAD only (was: every HTTP method accepted, no guards).
 * - Removed POST-with-DB branch: leaking "user count > 0" via public health endpoint
 *   is unnecessary signal for attackers + couples uptime probes to DB availability
 *   (false alarms when DB is slow but app shell works).
 * - For DB-health monitoring use the passive /api/health/database probe.
 * - Ścieżka tej trasy żyje też jako stała `HEALTH_ROUTE_ALIASES.HEALTH_CHECK`
 *   (application/health/health-route-aliases.ts) — to ona wpina alias w strict-tier
 *   rate-limitu. Przenosisz/zmieniasz nazwę pliku → zaktualizuj stałą (pilnuje testu).
 * - uptime_seconds is process-only and lets deploy automation distinguish the old
 *   live process from the freshly deployed one without querying the database.
 * - build_id is the Next.js artifact identity (.next/BUILD_ID). uptime alone proves
 *   only "a fresh process", and a fresh process can boot on the OLD artifact; the
 *   deploy gate compares this value with the locally built one to prove that THIS
 *   artifact is live. Rationale + safety of exposing it: application/health/build-id.ts.
 *
 * DECISION (nie usuwaj tego komentarza):
 * BDX W2.3: owinięty w `withPublicHandler({ cors: false, rateLimit: false })` — wrapper
 * daje WYŁĄCZNIE timing/error-scaffold. CORS prelude tego endpointu jest celowo INNY niż
 * współdzielony (OPTIONS → 200 nie 204; origin-reject → text/plain 406 'Origin not allowed'
 * nie JSON envelope), bo to load-balancer / uptime probe z ustalonym kontraktem. Zostaje
 * verbatim w `handle`, żeby NIE zmienić bajtów odpowiedzi probe'ów.
 */
export default withPublicHandler({
  allowedMethods: ['GET'],
  cors: false,
  rateLimit: false,
  handle: async (req, res) => {
    if (!isAllowedOrigin({ req, res })) {
      res.status(asStatusCode(406)).send('Origin not allowed');
      return;
    }
    setCORSHeaders({ req, res });

    if (req.method === 'OPTIONS') {
      res.status(asStatusCode(200)).end();
      return;
    }

    // DECISION (nie usuwaj tego komentarza):
    // HEAD = GET bez ciała i dokładnie to wysyła spora część monitorów uptime oraz
    // load-balancerów (`curl -I`) — wcześniej dostawały 405 i raportowały fałszywy DOWN.
    // HEAD celowo NIE trafia do `allowedMethods`: kernelowy `HTTPMethod` modeluje tylko
    // czasowniki CQRS (get/post/patch/delete), więc bramka metody żyje tutaj. 405 niesie
    // `Allow`, bo bez niego odpowiedź łamie RFC 9110 i nie mówi klientowi, czym ponowić.
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.setHeader('Allow', 'GET, HEAD');
      res.status(asStatusCode(405)).end();
      return;
    }

    if (!withRateLimitCheck(req, res)) {
      return;
    }

    // HEAD kończy się tu: te same nagłówki co GET, zero bajtów ciała (RFC 9110 §9.3.2).
    if (req.method === 'HEAD') {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.status(asStatusCode(200)).end();
      return;
    }

    respondSuccess(res, {
      status: 'APP_OK',
      uptime_seconds: Math.round(process.uptime()),
      build_id: getBuildId(),
    });
  },
});
