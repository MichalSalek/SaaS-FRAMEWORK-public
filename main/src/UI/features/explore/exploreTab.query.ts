// UI/features/explore/exploreTab.query.ts
// Deep link into a specific Explore tab: `/app/explore?tab=stylists`.
//
// DECISION (nie usuwaj tego komentarza):
// The tab is READ from the URL, never written back. /app/stylists and the
// drawer's "Przeglądaj stylistki" used to land on the default "Stylizacje" tab,
// so the label promised one screen and showed another (S122 QA). The redirect
// now carries `?tab=stylists` and ExplorePage opens that tab. Switching tabs
// stays local state: a shallow URL write on every switch would run through the
// navigation-transition controller (focus handoff, scroll policy) for what is an
// in-page toggle.

import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { ExploreTab } from './ExplorePage.parts.organism';

export const EXPLORE_TAB_QUERY_PARAM = 'tab';

const EXPLORE_TABS: ReadonlyArray<ExploreTab> = ['styles', 'stylists'];

/** Pure: `router.query.tab` → a known tab, or null when absent or unknown. */
export function parseExploreTabQuery(
  value: string | string[] | undefined
): ExploreTab | null {
  const raw = Array.isArray(value) ? value[0] : value;
  return EXPLORE_TABS.find(tab => tab === raw) ?? null;
}

/** Href of the Explore screen opened on `tab`. */
export function buildExploreTabHref(tab: ExploreTab): string {
  return `${ROUTES_FRONT.EXPLORE}?${EXPLORE_TAB_QUERY_PARAM}=${tab}`;
}
