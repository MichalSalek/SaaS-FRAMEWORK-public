import type { ParsedUrlQuery } from 'node:querystring';
import {
  ROUTES_API,
  ROUTES_FRONT,
} from '@kernel/domain/routing/routing.config';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';
import type { ProfileLinkKind } from '@kernel/models/db_models.generated.dto';
import { getSalonProfilePath } from '@kernel/domain/salon-profile/salon.urls';
import { buildRoute } from './buildRoute';
import { localePathPrefix } from './locale-url';

type Resolved = ACCOUNT_DTO_API_V1['ACCOUNT_RESOLVE_PROFILE_LINK']['RESPONSE'];

/**
 * Canonical address of the profile an old link now belongs to, with the visitor's query (utm and
 * the like) carried over. `routeParam` is the dynamic segment of the page that received the old
 * link; Next puts it into `query`, so it is dropped here.
 */
export function buildProfileLinkDestination({
  kind,
  resolved,
  locale,
  query,
  routeParam,
}: {
  kind: ProfileLinkKind;
  resolved: Resolved;
  locale: string;
  query: ParsedUrlQuery;
  routeParam: string;
}): string {
  const path =
    kind === 'SALON'
      ? getSalonProfilePath(
          {
            account_id: resolved.account_id,
            salon_vanity_url: resolved.current_slug,
          },
          locale
        )
      : `${localePathPrefix(locale)}${buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
          identifier: resolved.current_slug ?? resolved.account_id,
        })}/`;
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) {
    if (key === routeParam || value === undefined) {
      continue;
    }
    for (const item of Array.isArray(value) ? value : [value]) {
      params.append(key, item);
    }
  }
  const search = params.toString();
  return search ? `${path}?${search}` : path;
}

/**
 * Asks the backend whether `slug` is a retired link of a live profile. Only called after the live
 * lookup answered 404, so the common path pays nothing. Any failure means „no redirect” and the
 * page keeps its 404.
 */
export async function resolveRetiredProfileLink({
  backendUrl,
  kind,
  slug,
}: {
  backendUrl: string;
  kind: ProfileLinkKind;
  slug: string;
}): Promise<Resolved | null> {
  try {
    const response = await fetch(
      `${backendUrl}${ROUTES_API.ACCOUNT_RESOLVE_PROFILE_LINK}?kind=${kind}&slug=${encodeURIComponent(slug)}`
    );
    if (!response.ok) {
      return null;
    }
    const envelope = (await response.json()) as { data?: Resolved };
    return envelope.data ?? null;
  } catch {
    return null;
  }
}
