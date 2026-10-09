// Owner-vote seam: a live product route renders a candidate variant when the
// URL carries `?pg=<voteId>:<candidateId>` AND dev routes are enabled. The
// /dev/playground shell frames the same route with and without the parameter,
// so DZIŚ and every candidate run on identical data, session and viewport.
// Production never sees a variant: the gate is evaluated before the query.

export const PLAYGROUND_VARIANT_PARAM = 'pg';

const SEPARATOR = ':';

/** Candidate id for `voteId`, or null (no parameter, another vote, junk). */
export function parsePlaygroundVariant(
  raw: unknown,
  voteId: string
): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') {
    return null;
  }
  const [vote, candidate, ...rest] = value.split(SEPARATOR);
  if (rest.length > 0 || vote !== voteId || !candidate) {
    return null;
  }
  return candidate;
}

/** `route` with the variant parameter appended; `null` candidate = DZIŚ. */
export function withPlaygroundVariant(
  route: string,
  voteId: string,
  candidateId: string | null
): string {
  if (candidateId === null) {
    return route;
  }
  const cut = route.indexOf('#');
  const path = cut === -1 ? route : route.slice(0, cut);
  const hash = cut === -1 ? '' : route.slice(cut);
  const joiner = path.includes('?') ? '&' : '?';
  const value = encodeURIComponent(`${voteId}${SEPARATOR}${candidateId}`);
  return `${path}${joiner}${PLAYGROUND_VARIANT_PARAM}=${value}${hash}`;
}
