export const INTERNAL_TRAFFIC_COOKIE = 'nf_internal';

export function parseInternalTrafficOverride(search: string): boolean | null {
  const value = new URLSearchParams(search).get(INTERNAL_TRAFFIC_COOKIE);
  if (value === '1') {
    return true;
  }
  if (value === '0') {
    return false;
  }
  return null;
}

export function hasInternalTrafficCookie(cookieHeader: string): boolean {
  return cookieHeader
    .split(';')
    .some(cookie => cookie.trim() === `${INTERNAL_TRAFFIC_COOKIE}=1`);
}
