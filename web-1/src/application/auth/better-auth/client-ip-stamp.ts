import type { IncomingMessage } from 'node:http';
import { resolveTrustedClientIp } from '@app/http/trust-aware-ip';

/**
 * Header through which the auth route hands Better Auth the client IP it resolved itself.
 *
 * DECISION: Better Auth 1.7.5 has no IP resolver hook, only `advanced.ipAddress.ipAddressHeaders`,
 * and its own reading of `x-forwarded-for` rejects every multi-hop chain, so behind Cloudflare and
 * Render all clients fell into ONE shared `no-trusted-ip` bucket (15 production warnings in 7 days)
 * and the magic-link limit of 5 per minute was global. The auth route therefore resolves the IP
 * with the same trust-aware resolver as the app limiter (`trust-aware-ip.ts`) and writes it into
 * this header, after DELETING whatever the client sent under that name; Better Auth reads only this
 * header. Pointing Better Auth back at `x-forwarded-for` or `cf-connecting-ip` gives it a second,
 * weaker trust model. Only `pages/api/auth/[...all].ts` may stamp it.
 */
export const TRUSTED_CLIENT_IP_HEADER = 'x-nailfolio-client-ip';

/**
 * Replace any client-supplied value of {@link TRUSTED_CLIENT_IP_HEADER} with the trust-aware IP
 * (or remove it when none resolves, so Better Auth falls back to its shared fail-closed bucket).
 * Returns the stamped IP.
 */
export const stampTrustedClientIp = (
  req: Pick<IncomingMessage, 'headers'> & {
    socket?: { remoteAddress?: string | undefined } | undefined;
  }
): string | null => {
  delete req.headers[TRUSTED_CLIENT_IP_HEADER];
  const ip = resolveTrustedClientIp(
    req.headers,
    req.socket?.remoteAddress ?? null
  );
  if (ip !== null) {
    req.headers[TRUSTED_CLIENT_IP_HEADER] = ip;
  }
  return ip;
};

/** Read the stamped IP inside a Better Auth hook (Fetch `Headers`). */
export const readStampedClientIp = (
  headers: Headers | null | undefined
): string | null => {
  const value = headers?.get(TRUSTED_CLIENT_IP_HEADER)?.trim() ?? '';
  return value.length > 0 ? value : null;
};
