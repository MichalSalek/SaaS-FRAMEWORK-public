import { toNodeHandler } from 'better-auth/node';
import { auth } from '@app/auth/better-auth/better-auth.config';
import { stampTrustedClientIp } from '@app/auth/better-auth/client-ip-stamp';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import type { NextApiHandler } from 'next';

export const config = { api: { bodyParser: false } };

const handler = toNodeHandler(auth.handler);

const authHandler: NextApiHandler = async (req, res) => {
  // DECISION: CORS wrapper for [...all].ts. toNodeHandler bypasses cors.middleware, so ACAO/preflight are
  // set here by hand, and setCORSHeaders must run not only for OPTIONS but also on the actual response
  // (GET /get-session): without ACAO the browser blocks cross-origin => useSession() has no role => guard
  // bounce + degraded dashboard, and sign-in/social login fails (OAuth never starts).
  //
  // Runs in ALL environments, not dev-only: frontend and backend are cross-origin everywhere (dev
  // :3000/:3001, staging :443/:3101, preview/prod on separate hosts). A NODE_ENV==='development' gate
  // assumed "prod is same-origin", which is false, and left staging with no ACAO and OPTIONS 404. Safe in
  // prod: ACAO only for allowlisted origins (isAllowedOrigin -> CORS_ALLOWED_ORIGINS), and auth is
  // bearer-only zero-cookie (the localStorage token is unreachable cross-origin, no ambient credentials),
  // so CSRF/data leak do not apply (DECISION in cors.middleware.ts). A same-origin deploy ignores ACAO
  // harmlessly.
  if (req.method === 'OPTIONS') {
    setCORSHeaders({ req, res });
    res.status(204).end();
    return;
  }
  if (isAllowedOrigin({ req, res })) {
    setCORSHeaders({ req, res });
  }

  if (!withRateLimitCheck(req, res)) {
    return;
  }
  // Better Auth keys its limiter and session IP on this stamp (DECISION in client-ip-stamp.ts).
  stampTrustedClientIp(req);
  await handler(req, res);
};

export default withTimingNextHandlerMiddleware(authHandler);
