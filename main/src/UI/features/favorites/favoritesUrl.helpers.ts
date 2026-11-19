// UI/features/favorites/favoritesUrl.helpers.ts
// URL contract of /app/favorites: which tab is open and how the liked styles
// are arranged. In the query string so a link (or the back button) opens the
// „Stylistki” tab directly: `/app/favorites/?tab=stylists`.

import type { UrlStateCodec } from '../../shared/hooks/useUrlSyncedState';

export type FavoritesTab = 'styles' | 'stylists';
export type FavoritesStylesView = 'list' | 'grouped' | 'summary';

export interface FavoritesUrlState {
  tab: FavoritesTab;
  view: FavoritesStylesView;
}

const first = (value: string | string[] | undefined): string | undefined =>
  Array.isArray(value) ? value[0] : value;

export const FAVORITES_URL_CODEC: UrlStateCodec<FavoritesUrlState> = {
  keys: ['tab', 'view'],
  parse: query => {
    const view = first(query.view);
    return {
      tab: first(query.tab) === 'stylists' ? 'stylists' : 'styles',
      view: view === 'grouped' || view === 'summary' ? view : 'list',
    };
  },
  // Defaults are omitted so the plain address stays clean.
  build: state => ({
    ...(state.tab === 'stylists' ? { tab: state.tab } : {}),
    ...(state.view !== 'list' ? { view: state.view } : {}),
  }),
};
