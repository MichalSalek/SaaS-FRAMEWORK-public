import { ROUTES_API } from '@kernel/domain/routing/routing.config';

const tokenRoutePrefixes = Object.values(ROUTES_API)
  .filter(route => route.includes('[token]'))
  .map(route => route.split('[token]')[0])
  .filter((prefix): prefix is string => Boolean(prefix));

/** Query strings and one-time path tokens never belong in stored observation URLs. */
export function sanitizeObservationUrl(value: string): string {
  const cut = value.search(/[?#]/);
  let safe = cut === -1 ? value : value.slice(0, cut);
  for (const prefix of tokenRoutePrefixes) {
    const start = safe.indexOf(prefix);
    if (start < 0) {
      continue;
    }
    const tokenStart = start + prefix.length;
    const nextSlash = safe.indexOf('/', tokenStart);
    const tokenEnd = nextSlash === -1 ? safe.length : nextSlash;
    if (tokenEnd > tokenStart) {
      safe = `${safe.slice(0, tokenStart)}[REDACTED]${safe.slice(tokenEnd)}`;
    }
  }
  return safe;
}
