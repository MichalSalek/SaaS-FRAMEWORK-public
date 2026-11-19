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

const varyTokens = (
  value: string | string[] | number | undefined
): string[] => {
  const values = Array.isArray(value)
    ? value
    : value === undefined
      ? []
      : [value];
  return values
    .flatMap(headerValue => String(headerValue).split(','))
    .map(token => token.trim())
    .filter(Boolean);
};

const varyOnOrigin = (res: NextApiWithOptionalPayload['res']): void => {
  const tokens = varyTokens(res.getHeader('Vary'));

  if (tokens.some(token => token === '*')) {
    res.setHeader('Vary', '*');
    return;
  }

  const seen = new Set<string>();
  const mergedTokens = tokens.filter(token => {
    const normalized = token.toLowerCase();
    if (seen.has(normalized)) {
      return false;
    }
    seen.add(normalized);
    return true;
  });

  if (!seen.has('origin')) {
    mergedTokens.push('Origin');
  }

  res.setHeader('Vary', mergedTokens.join(', '));
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

  varyOnOrigin(res);
};
