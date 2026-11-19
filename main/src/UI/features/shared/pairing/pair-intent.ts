import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

/** Keeps the path and hash, and sets `pair=1` so the profile opens the request dialog. */
export const withPairIntent = (profilePath: string): string => {
  const hashAt = profilePath.indexOf('#');
  const hash = hashAt === -1 ? '' : profilePath.slice(hashAt);
  const withoutHash =
    hashAt === -1 ? profilePath : profilePath.slice(0, hashAt);
  const queryAt = withoutHash.indexOf('?');
  const path = queryAt === -1 ? withoutHash : withoutHash.slice(0, queryAt);
  const params = new URLSearchParams(
    queryAt === -1 ? '' : withoutHash.slice(queryAt + 1)
  );
  params.set('pair', '1');
  const query = params.toString();
  return `${path}?${query}${hash}`;
};

/** Guest login that returns to this profile with the request dialog armed. */
export const pairIntentLoginHref = (profilePath: string): string =>
  `${ROUTES_FRONT.USER_LOG}?from=${encodeURIComponent(withPairIntent(profilePath))}`;

export const isPairIntentQuery = (
  value: string | string[] | undefined
): boolean => {
  const raw = Array.isArray(value) ? value[0] : value;
  return raw === '1';
};

export const withoutPairIntent = (profilePath: string): string => {
  const hashAt = profilePath.indexOf('#');
  const hash = hashAt < 0 ? '' : profilePath.slice(hashAt);
  const base = hashAt < 0 ? profilePath : profilePath.slice(0, hashAt);
  const queryAt = base.indexOf('?');
  if (queryAt < 0) {
    return profilePath;
  }
  const query = new URLSearchParams(base.slice(queryAt + 1));
  query.delete('pair');
  const encoded = query.toString();
  return `${base.slice(0, queryAt)}${encoded ? `?${encoded}` : ''}${hash}`;
};
