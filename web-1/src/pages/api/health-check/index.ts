import { getBuildId } from '@app/health/build-id';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withPublicHandler } from '@app/http/define-raw-handler';
import { respondSuccess } from '@app/http/http.responses.utils';
import { asStatusCode } from '@app/http/http.utils.api';

/**
 * DECISION: public health is CORS allowlist, rate limit and GET/HEAD only. No DB branch:
 * a user count leaks signal and ties uptime probes to the database (use /api/health/database).
 * HEALTH_ROUTE_ALIASES.HEALTH_CHECK is the strict rate-limit hook. uptime_seconds is
 * process-only; build_id is the Next artifact id (application/health/build-id.ts).
 * withPublicHandler({ cors: false, rateLimit: false }) supplies only the timing scaffold.
 * Probe CORS differs (OPTIONS 200, origin reject text/plain 406) and stays verbatim in handle.
 */
export default withPublicHandler({
  // HEAD = GET without a body (uptime monitors, `curl -I`); OPTIONS is answered below with this
  // probe's own preflight contract. Every other method gets 405 + Allow from the wrapper.
  allowedMethods: ['GET', 'HEAD', 'OPTIONS'],
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

    // DECISION: HEAD = GET without a body, which many uptime monitors and load balancers send (`curl -I`);
    // they used to get 405 and report a false DOWN. The method gate (405 + Allow) is the wrapper's,
    // driven by `allowedMethods` above.
    if (!withRateLimitCheck(req, res)) {
      return;
    }

    // HEAD ends here: same headers as GET, zero body bytes (RFC 9110 §9.3.2).
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
