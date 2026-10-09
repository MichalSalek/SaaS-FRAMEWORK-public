import { toNodeHandler } from 'better-auth/node';
import { auth } from '@app/auth/better-auth/better-auth.config';
import { withRateLimitCheck } from '@app/http/rate-limit.middleware';
import { withTimingNextHandlerMiddleware } from '@app/http/timing.middleware';
import { isAllowedOrigin, setCORSHeaders } from '@app/cors/cors.middleware';
import type { NextApiHandler } from 'next';

export const config = { api: { bodyParser: false } };

const handler = toNodeHandler(auth.handler);

const authHandler: NextApiHandler = async (req, res) => {
  // DECISION (nie usuwaj): CORS-wrapper dla [...all].ts — toNodeHandler omija
  // cors.middleware, wiec ACAO/preflight ustawiamy tu recznie. setCORSHeaders MUSI
  // leciec NIE tylko na OPTIONS preflight, ale TEZ na faktyczna odpowiedz (GET
  // /get-session): bez ACAO przegladarka blokuje cross-origin → useSession() bez roli
  // → guard bounce + dashboard degraded; sign-in/social tez pada (OAuth nie startuje).
  //
  // BIEGNIE WE WSZYSTKICH SRODOWISKACH (NIE dev-only). Stary gate NODE_ENV==='development'
  // zakladal „prod same-origin" — to NIEPRAWDA dla obecnej topologii: front↔back jest
  // cross-origin WSZEDZIE (dev :3000↔:3001 · staging :443↔:3101 · preview/prod
  // *.example.com ↔ backend.example.com). Przez gate prod-mode auth-calls dostawaly brak
  // ACAO + OPTIONS 404 → cross-origin blokowany → logowanie/OAuth martwe na staging (i
  // tak samo padloby na preview/prod). Bezpieczne w prod: ACAO TYLKO dla allowlisted
  // origin (isAllowedOrigin → CORS_ALLOWED_ORIGINS), a auth jest bearer-only zero-cookie
  // (token w localStorage niedostepny cross-origin, brak ambient credentials) →
  // CSRF/data-leak N/A (DECISION cors.middleware §A). Same-origin deploy: ACAO
  // niepotrzebne ale nieszkodliwe (ignorowane), a OPTIONS-preflight i tak nie leci same-origin.
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
  await handler(req, res);
};

export default withTimingNextHandlerMiddleware(authHandler);
