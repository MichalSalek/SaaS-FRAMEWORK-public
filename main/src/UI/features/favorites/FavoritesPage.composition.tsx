// UI/features/favorites/FavoritesPage.composition.tsx
// Favorites: two tabs, „Stylizacje” (liked photos) and „Stylistki” (liked
// profiles). The intro and the tabs are always on screen; loading, failure
// and emptiness are states of the PANEL under them, so nothing above jumps
// and the other tab stays reachable when one query fails.
// The open tab and the arrangement of styles live in the URL
// (favoritesUrl.helpers.ts): `/app/favorites/?tab=stylists` opens the list.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { AppHeroOrganism } from '../../components/AppHero/AppHero.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { InfiniteScrollTriggerComposition } from '../../components/InfiniteScrollTrigger.composition';
import { SegmentedControlMolecule } from '../../components/SegmentedControl/SegmentedControl.molecule';
import { useUrlSyncedState } from '../../shared/hooks/useUrlSyncedState';
import {
  useFavoriteRecords,
  flattenFavoriteRecordsPages,
} from '../shared/favorites/hooks/useFavoriteRecords';
import {
  useBookmarkedStylists,
  flattenBookmarkedPages,
} from '../shared/favorites/hooks/useBookmarkedStylists';
import { useUnbookmarkStylist } from '../shared/favorites/hooks/useUnbookmarkStylist';
import { useRemoveFavorite } from './hooks/useRemoveFavorite';
import { FAVORITES_URL_CODEC, type FavoritesTab } from './favoritesUrl.helpers';
import { FavoritesPanelSkeletonMolecule } from './FavoritesPage.parts.organism';
import {
  FavoritesRemoveDialogMolecule,
  type FavoritesRemoval,
} from './FavoritesRemoveDialog.molecule';
import { StylesTabOrganism } from './components/StylesTab.organism';
import { StylistsTabOrganism } from './components/StylistsTab.organism';
import styles from './FavoritesPage.module.css';

function FavoritesPageInner() {
  const t = useTranslations('pages.favorites');
  useAppBarTitle(t('collectionTitle'));

  const [urlState, setUrlState, isUrlReady] =
    useUrlSyncedState(FAVORITES_URL_CODEC);
  const activeTab = urlState.tab;
  const [removal, setRemoval] = useState<FavoritesRemoval | null>(null);

  const records = useFavoriteRecords();
  const bookmarked = useBookmarkedStylists();
  const removeFavoriteMutation = useRemoveFavorite();
  const unbookmarkMutation = useUnbookmarkStylist();

  const styleItems = flattenFavoriteRecordsPages(records.data);
  const stylistItems = flattenBookmarkedPages(bookmarked.data);

  // Intro numbers: only what is really loaded. A query in flight or failed
  // leaves its number out; a later page still to come is marked with „+”.
  const showStylesMeta = !records.isLoading && styleItems.length > 0;
  const showStylistsMeta = !bookmarked.isLoading && stylistItems.length > 0;
  const heroMeta =
    showStylesMeta || showStylistsMeta ? (
      <>
        {showStylesMeta && (
          <span>
            <strong>
              {styleItems.length}
              {records.hasNextPage ? '+' : ''}
            </strong>{' '}
            {t('heroMetaStyles', { count: styleItems.length })}
          </span>
        )}
        {showStylistsMeta && (
          <span>
            <strong>
              {stylistItems.length}
              {bookmarked.hasNextPage ? '+' : ''}
            </strong>{' '}
            {t('heroMetaStylists', { count: stylistItems.length })}
          </span>
        )}
      </>
    ) : undefined;

  const confirmRemoval = (confirmed: FavoritesRemoval) => {
    if (confirmed.kind === 'style') {
      removeFavoriteMutation.mutate({ gallery_record_id: confirmed.id });
    } else {
      unbookmarkMutation.mutate({ stylist_account_id: confirmed.id });
    }
    setRemoval(null);
  };

  const active = activeTab === 'styles' ? records : bookmarked;
  const activeCount =
    activeTab === 'styles' ? styleItems.length : stylistItems.length;
  // Until the URL was read the tab is not known yet: a deep link to
  // „Stylistki” must not flash the styles grid first.
  const showSkeleton = !isUrlReady || active.isLoading;
  // A failed LATER page keeps the loaded items (the scroll trigger retries).
  const showError = !showSkeleton && active.isError && activeCount === 0;

  return (
    <div className={styles.page}>
      <AppHeroOrganism
        title={t('heroTitle')}
        accentInline={t('heroTitleAccent')}
        meta={heroMeta}
      />

      <SegmentedControlMolecule<FavoritesTab>
        semantics='tabs'
        size='md'
        shape='pill'
        fullWidth
        className={styles.tabs}
        optionClassName='haptic-press'
        ariaLabel={t('collectionTitle')}
        value={activeTab}
        onChange={tab => setUrlState(prev => ({ ...prev, tab }))}
        options={[
          {
            value: 'styles',
            label: t('stylesTab'),
            id: 'favorites-tab-styles',
            controls: 'favorites-panel',
          },
          {
            value: 'stylists',
            label: t('stylistsTab'),
            id: 'favorites-tab-stylists',
            controls: 'favorites-panel',
          },
        ]}
      />

      {/* The single tabpanel the two tabs control. */}
      <div
        id='favorites-panel'
        role='tabpanel'
        aria-labelledby={`favorites-tab-${activeTab}`}
        aria-busy={showSkeleton}
        className={styles.tabContent}>
        {/* Tor treści = kontener zapytań rozmiarowych (DECISION w CSS). */}
        <div className={styles.pageTrack}>
          {showSkeleton ? (
            <FavoritesPanelSkeletonMolecule tab={activeTab} />
          ) : showError ? (
            <ErrorStateMolecule
              message={t('loadError')}
              retryLabel={t('retry')}
              onRetry={() => void active.refetch()}
              isRetrying={active.isFetching}
            />
          ) : activeTab === 'styles' ? (
            <>
              <StylesTabOrganism
                records={styleItems}
                viewMode={urlState.view}
                onViewModeChange={view =>
                  setUrlState(prev => ({ ...prev, view }))
                }
                onRemove={id => setRemoval({ kind: 'style', id })}
              />
              <InfiniteScrollTriggerComposition
                hasNextPage={records.hasNextPage}
                isFetchingNextPage={records.isFetchingNextPage}
                isFetchNextPageError={records.isFetchNextPageError}
                onFetchNextPage={records.fetchNextPage}
              />
            </>
          ) : (
            <>
              <StylistsTabOrganism
                stylists={stylistItems}
                pagination={{
                  hasNextPage: bookmarked.hasNextPage,
                  isFetchingNextPage: bookmarked.isFetchingNextPage,
                  isFetchNextPageError: bookmarked.isFetchNextPageError,
                  fetchNextPage: bookmarked.fetchNextPage,
                }}
                onRemoveBookmark={(id, name) =>
                  setRemoval({ kind: 'stylist', id, name })
                }
                removingAccountId={
                  unbookmarkMutation.isPending
                    ? (unbookmarkMutation.variables?.stylist_account_id ?? null)
                    : null
                }
              />
              <InfiniteScrollTriggerComposition
                hasNextPage={bookmarked.hasNextPage}
                isFetchingNextPage={bookmarked.isFetchingNextPage}
                isFetchNextPageError={bookmarked.isFetchNextPageError}
                onFetchNextPage={bookmarked.fetchNextPage}
              />
            </>
          )}
        </div>
      </div>

      <FavoritesRemoveDialogMolecule
        removal={removal}
        onConfirm={confirmRemoval}
        onClose={() => setRemoval(null)}
      />
    </div>
  );
}

export function FavoritesPageComposition() {
  const t = useTranslations('pages.favorites');
  return (
    <AppLayoutComposition title={t('collectionTitle')}>
      <FavoritesPageInner />
    </AppLayoutComposition>
  );
}
