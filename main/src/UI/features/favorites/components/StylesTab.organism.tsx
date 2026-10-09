// UI/features/favorites/components/StylesTab.organism.tsx
// „Stylizacje” tab. Three arrangements of the same liked photos, chosen with
// one segmented control (the choice lives in the URL, owned by the page):
// all photos, photos under each stylist, or a short per-stylist summary
// (GET /api/v1/favorite/get-grouped).

import { useTranslations } from 'next-intl';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../../application/routing/buildRoute';
import type { FAVORITE_DTO_API_V1 } from '@kernel/models/favorites/favorite.dto';
import { AvatarAtom } from '../../../components/Avatar/Avatar.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { SegmentedControlMolecule } from '../../../components/SegmentedControl/SegmentedControl.molecule';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { FavoritesStylesEmptyOrganism } from '../FavoritesPage.parts.organism';
import type { FavoritesStylesView } from '../favoritesUrl.helpers';
import { useUpdateFavoriteNote } from '../hooks/useUpdateFavoriteNote';
import { useFavoriteGrouped } from '../hooks/useFavoriteGrouped';
import {
  FavoriteCardOrganism,
  SummaryGroupCardOrganism,
  type NoteUpdateHandler,
} from './StylesTab.parts.organism';
import styles from '../FavoritesPage.module.css';

type FavoriteRecord =
  FAVORITE_DTO_API_V1['FAVORITE_GET_RECORDS']['RESPONSE']['records'][number];

export function StylesTabOrganism({
  records,
  viewMode,
  onViewModeChange,
  onRemove,
}: {
  records: FavoriteRecord[];
  viewMode: FavoritesStylesView;
  onViewModeChange: (view: FavoritesStylesView) => void;
  onRemove: (galleryRecordId: string) => void;
}) {
  const t = useTranslations('pages.favorites');
  const tLabels = useTranslations('labels');
  const router = useRouter();
  const updateNoteMutation = useUpdateFavoriteNote();
  const groupedQuery = useFavoriteGrouped(viewMode === 'summary');

  const handleUpdateNote: NoteUpdateHandler = (
    galleryRecordId,
    note,
    callbacks
  ) => {
    // mutateAsync, not mutate(vars, callbacks): per-call callbacks of `mutate`
    // fire only for the LATEST call, so saving on two cards in a row would
    // leave the first card stuck in „saving". The promise settles per call.
    void updateNoteMutation
      .mutateAsync({ gallery_record_id: galleryRecordId, note })
      .then(callbacks.onSuccess, callbacks.onError);
  };

  const handleOpenPhoto = (galleryRecordId: string) => {
    void router.push(
      buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id: galleryRecordId })
    );
  };

  const groupedRecords = (() => {
    if (viewMode !== 'grouped') {
      return null;
    }
    const groups = new Map<
      string,
      { name: string; records: FavoriteRecord[] }
    >();
    for (const record of records) {
      const key = record.stylist_account_id;
      const existing = groups.get(key);
      if (existing) {
        existing.records.push(record);
      } else {
        groups.set(key, {
          name: record.stylist_display_name ?? tLabels('stylistFallback'),
          records: [record],
        });
      }
    }
    return Array.from(groups.entries()).map(([accountId, group]) => ({
      accountId,
      ...group,
    }));
  })();

  if (records.length === 0) {
    return <FavoritesStylesEmptyOrganism />;
  }

  return (
    <>
      <SegmentedControlMolecule<FavoritesStylesView>
        size='sm'
        shape='pill'
        className={styles.viewSwitch}
        ariaLabel={t('stylesViewLabel')}
        value={viewMode}
        onChange={onViewModeChange}
        options={[
          { value: 'list', label: t('stylesTabShowAll') },
          { value: 'grouped', label: t('stylesTabGroup') },
          { value: 'summary', label: t('stylesTabSummary') },
        ]}
      />

      {viewMode === 'summary' ? (
        groupedQuery.isError && groupedQuery.data === undefined ? (
          <ErrorStateMolecule
            message={t('loadError')}
            retryLabel={t('retry')}
            onRetry={() => void groupedQuery.refetch()}
            isRetrying={groupedQuery.isFetching}
          />
        ) : (
          <div className={styles.summaryGrid}>
            {groupedQuery.isLoading &&
              [0, 1, 2].map(i => (
                <SkeletonAtom
                  key={i}
                  variant='rect'
                  width='100%'
                  height={148}
                />
              ))}
            {groupedQuery.data?.groups.map(group => (
              <SummaryGroupCardOrganism
                key={group.stylist_account_id}
                group={group}
              />
            ))}
          </div>
        )
      ) : viewMode === 'grouped' && groupedRecords ? (
        <div className={styles.groupedView}>
          {groupedRecords.map(group => (
            <section key={group.accountId} className={styles.stylistGroup}>
              <header className={styles.groupHeader}>
                <AvatarAtom name={group.name} size='sm' decorative />
                <span className={styles.groupHeaderText}>
                  <h3 className={styles.groupHeaderName}>{group.name}</h3>
                  <span className={styles.groupHeaderCount}>
                    {t('groupCount', { count: group.records.length })}
                  </span>
                </span>
              </header>
              <div className={styles.galleryGrid}>
                {group.records.map(record => (
                  <FavoriteCardOrganism
                    key={record.gallery_record_id}
                    record={record}
                    onRemove={onRemove}
                    onUpdateNote={handleUpdateNote}
                    onCardClick={handleOpenPhoto}
                  />
                ))}
              </div>
            </section>
          ))}
        </div>
      ) : (
        <div className={styles.galleryGrid}>
          {records.map(record => (
            <FavoriteCardOrganism
              key={record.gallery_record_id}
              record={record}
              onRemove={onRemove}
              onUpdateNote={handleUpdateNote}
              showFooter
              onCardClick={handleOpenPhoto}
            />
          ))}
        </div>
      )}
    </>
  );
}
