import type { NextApiWithOptionalPayload } from '@app/http/http.types';
import { IS_DEVELOPMENT_ENV } from '@app/environment/environment.utils.api';
import {
  CORS_ALLOWED_ORIGINS,
  CORS_HEADERS_KEYS,
  CORS_HEADERS_VALUES,
} from './cors.config';

// DEV-only: trust any localhost / loopback / private-LAN http(s) origin regardless
// of port. The dev backend (ten WSL) is hit by MANY local frontends — Next dev
// (:3000), the Capacitor wrapper's Vite server, LAN device testing (192.168.x) —
// and pinning FRONTEND_PUBLIC_PORT to ONE port silently broke whichever frontend it
// wasn't set to: the CORS preflight got rejected and login/API calls failed with
// "Access-Control-Allow-Origin ... not equal to the supplied origin". CORS here is
// defense-in-depth only (primary auth = Bearer token, see the DECISION block below),
// so widening it for local origins costs nothing — and it NEVER reaches prod: gated
// on NODE_ENV_MANUAL === 'DEVELOPMENT' (STAGING/PRODUCTION keep the exact allow-list).
const isDevLocalOrigin = (origin: string): boolean => {
  if (!IS_DEVELOPMENT_ENV()) {
    return false;
  }
  try {
    const { protocol, hostname } = new URL(origin);
    if (protocol !== 'http:' && protocol !== 'https:') {
      return false;
    }
    return (
      hostname === 'localhost' ||
      hostname === '127.0.0.1' ||
      hostname === '[::1]' ||
      hostname.startsWith('192.168.') ||
      hostname.startsWith('10.') ||
      hostname.startsWith('172.')
    );
  } catch {
    return false;
  }
};

const getOriginFromRequest = ({ req }: NextApiWithOptionalPayload): string => {
  const originHeader = req.headers?.origin;
  if (typeof originHeader === 'string' && originHeader.trim() !== '') {
    return originHeader;
  }

  const refererHeader = req.headers?.referer;
  if (typeof refererHeader === 'string' && refererHeader.trim() !== '') {
    try {
      const url = new URL(refererHeader);
      return url.origin;
    } catch {
      return '';
    }
  }

  return '';
};

// DECISION (nie usuwaj tego komentarza):
// CSRF / Origin validation posture (PLQS F4-8 audit, 2026-05-28):
//
// Empty Origin zwraca true CELOWO. Powody:
// (1) Capacitor WebView (mobile app) NIE wysyła Origin header
// (2) Server-to-server calls (Stripe webhooks, internal cron) nie mają Origin
// (3) curl/Postman testing bez Origin musi działać w dev
//
// Primary auth = Bearer token w Authorization header (Better Auth bearer plugin), NIE CORS.
// CORS dla Bearer auth jest defense-in-depth, nie primary control.
// Endpoint-level guards (currentUser, permissions) chronią dane — CORS tylko filtruje cross-origin browser calls.
//
// CSRF posture per route category (audit PLQS Wave 4E):
//   A) Bearer-auth routes (cała powierzchnia v1/, dev-login):
//      Frontend `main/src/application/http/http.possibilities.api.ts` NIE używa
//      `credentials: 'include'` — przeglądarka nie wysyła cookies cross-origin.
//      Token leci w `Authorization` header z clientStorage → CSRF inherently N/A
//      (klasyczny CSRF wymaga ambient credentials = cookies/HTTP auth).
//      `isAllowedOrigin` tutaj = defense-in-depth + CORS preflight kompatybilność.
//   B) Cookie-session-only browser routes: **NIE ISTNIEJĄ** w bieżącym kodzie.
//      Better Auth bearer() plugin (zob. better-auth.config.ts) jest single
//      session transport. Cookie session pozostaje w `/api/auth/*` (Better Auth
//      handler) — tam ochrona via wbudowany `originCheckMiddleware` BA +
//      `trustedOrigins` allow-list (CSRF + callbackURL validation built-in).
//   C) S2S webhooks (`webhooks/stripe/`, `internal/track-crawler/`):
//      CSRF-exempt by design. Authentication = signature/secret, nie session:
//        - Stripe: `stripe.webhooks.constructEvent` HMAC sig na raw body
//        - track-crawler: `crypto.timingSafeEqual` na `x-internal-secret`
//      Atakujący bez sekretu nie wykona requesta — CSRF wektor nieosiągalny.
//      Te route'y intencjonalnie BYPASSUJĄ middleware (raw handler) — patrz
//      DECISION w obu plikach.
//   D) Public no-auth (status page, og-meta, newsletter-subscribe/-confirm,
//      pricing/get-plans, account/increment-view):
//      Brak session = brak CSRF wektora (nic do "ride-along"). Operacje albo
//      idempotent reads albo token-bound writes (newsletter confirm via DB token).
//
// Werdykt audytu: ZERO routes wymagają dodatkowej Origin validation poza
// istniejącą `isAllowedOrigin`. `validateOrigin` middleware NIE jest potrzebne —
// nasza powierzchnia ataku nie ma kategorii B (browser cookie session).
// Re-audytuj TYLKO jeśli: (a) dodamy `credentials: 'include'` na froncie,
// (b) dodamy route przyjmujący cookie session zamiast Bearer, (c) zrezygnujemy
// z bearer() plugin BA.
export const isAllowedOrigin = ({
  req,
  res,
}: NextApiWithOptionalPayload): boolean => {
  const origin = getOriginFromRequest({ req, res });
  if (!origin) {
    return true;
  }
  return CORS_ALLOWED_ORIGINS.includes(origin) || isDevLocalOrigin(origin);
};

export const setCORSHeaders = ({ req, res }: NextApiWithOptionalPayload) => {
  const origin = getOriginFromRequest({ req, res });

  if (origin) {
    res.setHeader('Access-Control-Allow-Origin', origin);
  }

  for (let i = 0; i < CORS_HEADERS_KEYS.length; i++) {
    const key = CORS_HEADERS_KEYS[i];
    const value = CORS_HEADERS_VALUES[i];
    if (key === undefined || value === undefined) {
      continue;
    }
    res.setHeader(key, value);
  }
};
