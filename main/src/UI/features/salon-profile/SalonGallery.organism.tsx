import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { AppLinkAtom } from '../../components/AppLink/AppLink.atom';
import { useRouter } from 'next/router';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { buildRoute } from '../../../application/routing/buildRoute';
import { GalleryFilterOverlayOrganism } from '../../components/GalleryFilterOverlay/GalleryFilterOverlay.organism';
import { useGalleryFiltersState } from '../shared/gallery/hooks/useGalleryFiltersState';
import { useNailLengthOptions } from '../shared/gallery/nailLengthOptions.config';
import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { isIOError } from '../../../application/http/io';
import { useSalonGallery } from './useSalonGallery';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { SelectAtom } from '../../components/Select/Select.atom';
import type { SessionPhotoPicker } from '../shared/sessions/hooks/useSessionPhotoPicker';
import styles from './SalonProfileManage.module.css';
export function SalonGalleryOrganism({
  salonAccountId,
  publicOnly = false,
  sessionPicker,
  excludeIds = [],
  selection,
  audience = 'client',
  onUnavailable,
}: {
  salonAccountId: string;
  publicOnly?: boolean;
  audience?: 'client' | 'team';
  onUnavailable?: () => void;
  /** Set while a client chooses photos for a session (the gallery's pick
   *  mode): each work then carries the add / take back button. */
  sessionPicker?: SessionPhotoPicker;
  excludeIds?: string[];
  /** Settings mode: the owner picks the works pinned on the salon profile.
   *  The surrounding section carries the heading and the counter; `notice`
   *  is said above the works only when a tap was refused (plan limit). */
  selection?: {
    ids: string[];
    onToggle: (id: string, selected: boolean) => void;
    notice: string | null;
  };
}) {
  const t = useTranslations('salon.profile');
  const router = useRouter();
  const tFilter = useTranslations('galleryFilter');
  const tLabels = useTranslations('labels');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const allNailLengths = useNailLengthOptions();
  const [stylist, setStylist] = useState('');
  const gallery = useSalonGallery(
    salonAccountId,
    publicOnly,
    stylist,
    selection ? 6 : undefined
  );
  useEffect(() => {
    if (
      audience === 'team' &&
      isIOError(gallery.error) &&
      gallery.error.httpError.event ===
        APP_EVENTS.INFO.ACCOUNT.ACCOUNT_NOT_FOUND
    ) {
      onUnavailable?.();
    }
  }, [audience, gallery.error, onUnavailable]);
  const records = gallery.data?.pages.flatMap(page => page.records) ?? [];
  const filter = useGalleryFiltersState(records);
  const contributors = gallery.data?.pages[0]?.contributors ?? [];
  if (gallery.isLoading) {
    return <SkeletonAtom variant='rect' width='100%' height={240} />;
  }
  if (!gallery.data && gallery.isError) {
    return (
      <ErrorStateMolecule
        message={t('galleryLoadError')}
        retryLabel={t('retry')}
        onRetry={() => void gallery.refetch()}
        isRetrying={gallery.isFetching}
      />
    );
  }
  // On the public page an empty team gallery would repeat the empty pinned
  // section above it word for word; it shows once there is something to see.
  if (publicOnly && records.length === 0 && stylist === '') {
    return null;
  }
  return (
    <section className={selection ? styles.galleryContent : styles.form}>
      {/* In settings the section around the gallery names it (ProfileManageSection). */}
      {!selection && (
        <>
          <TypographyAtom variant='h2' as='h2'>
            {t('teamWorks')}
          </TypographyAtom>
          <TypographyAtom>
            {t(
              publicOnly
                ? 'publicGalleryHelp'
                : audience === 'team'
                  ? 'teamGalleryHelp'
                  : 'fullGalleryHelp'
            )}
          </TypographyAtom>
        </>
      )}
      <SelectAtom
        disabled={records.length === 0 && stylist === ''}
        value={stylist}
        onChange={event => setStylist(event.target.value)}
        label={t('filterStylist')}
        options={[
          { value: '', label: t('allStylists') },
          ...contributors.map(person => ({
            value: person.account_id,
            label: person.name || tLabels('stylistFallback'),
          })),
        ]}
      />
      {/* Choosing works for the salon card needs the author filter only; the
          colour and style filters belong to browsing. */}
      {!selection && (
        <ButtonAtom
          variant='outlined'
          disabled={records.length === 0}
          onClick={() => setFiltersOpen(true)}>
          {tFilter('title')}
        </ButtonAtom>
      )}
      <GalleryFilterOverlayOrganism
        isOpen={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        allColors={filter.availableColors}
        allTraits={filter.availableTraits}
        allNailLengths={allNailLengths}
        availableColors={filter.availableColors}
        availableTraits={filter.availableTraits}
        availableNailLengths={filter.availableNailLengths}
        selectedColors={filter.filters.selectedColors}
        selectedTraits={filter.filters.selectedTraits}
        selectedLength={filter.filters.selectedLength}
        exactMatch={filter.filters.exactMatch}
        matchingCount={filter.filteredRecords.length}
        resultsIncomplete={gallery.hasNextPage}
        totalActiveFilters={filter.totalActiveFilters}
        onToggleColor={filter.toggleColor}
        onToggleTrait={filter.toggleTrait}
        onToggleLength={filter.toggleLength}
        onExactMatchChange={filter.setExactMatch}
        onClearAll={filter.clearAll}
      />
      {records.length === 0 && (
        <div className={styles.contactFields}>
          <TypographyAtom>
            {t(
              stylist !== ''
                ? 'emptyFiltered'
                : selection
                  ? 'emptyOwnWorks'
                  : 'emptyGallery'
            )}
          </TypographyAtom>
          {selection && stylist === '' && (
            <LinkButtonAtom
              variant='outlined'
              href={ROUTES_FRONT.GALLERY_UPLOAD_ASSET}>
              {t('addFirstWork')}
            </LinkButtonAtom>
          )}
        </div>
      )}
      {selection && (
        <TypographyAtom variant='body2' aria-live='polite'>
          {selection.notice}
        </TypographyAtom>
      )}
      {/* DECISION: the salon's works are the SAME photo card as in the stylist gallery, in two
          columns. Each work used to have a "Przypnij pracę" field above the photo, and the
          public profile one huge column with the author's name in an outlined button (read as
          an action button). The choice for the profile and for a session is a mark in the card
          corner; the author is a plain link under the photo. */}
      <div className={styles.galleryWorks}>
        {filter.filteredRecords
          .filter(work => !excludeIds.includes(work.gallery_record_id))
          .map(work => {
            const id = work.gallery_record_id;
            const author = (
              <AppLinkAtom
                href={buildRoute(ROUTES_FRONT.STYLIST_PROFILE, {
                  identifier: work.author.identifier,
                })}
                className={styles.workAuthor}>
                {/* A member onboarded with the role alone has no name yet. */}
                {work.author.name || tLabels('stylistFallback')}
              </AppLinkAtom>
            );
            if (selection) {
              const selected = selection.ids.includes(id);
              return (
                <GalleryPhotoCardOrganism
                  key={id}
                  record={{ ...work, is_pinned: false }}
                  footer={author}
                  onCardClick={() => selection.onToggle(id, !selected)}
                  selection={{
                    selected,
                    addLabel: t('showcaseAdd'),
                    removeLabel: t('showcaseRemove'),
                  }}
                />
              );
            }
            if (sessionPicker !== undefined) {
              return (
                <GalleryPhotoCardOrganism
                  key={id}
                  record={{ ...work, is_pinned: false }}
                  footer={author}
                  onCardClick={() => sessionPicker.toggle(id)}
                  selection={{
                    selected: sessionPicker.isPicked(id),
                    pending:
                      !sessionPicker.isReady || sessionPicker.isPending(id),
                    addLabel: t('pickWork'),
                    removeLabel: t('unpickWork'),
                  }}
                />
              );
            }
            return (
              <GalleryPhotoCardOrganism
                key={id}
                record={{ ...work, is_pinned: false }}
                footer={author}
                {...(!publicOnly && {
                  onCardClick: () =>
                    void router.push(
                      buildRoute(ROUTES_FRONT.PHOTO_DETAIL, { id })
                    ),
                })}
              />
            );
          })}
      </div>
      {gallery.hasNextPage && (
        <ButtonAtom
          variant='outlined'
          disabled={gallery.isFetchingNextPage}
          onClick={() => void gallery.fetchNextPage()}>
          {t('moreWorks')}
        </ButtonAtom>
      )}
      {gallery.isFetchNextPageError && (
        <ErrorStateMolecule
          message={t('moreWorksLoadError')}
          retryLabel={t('retry')}
          onRetry={() => void gallery.fetchNextPage()}
          isRetrying={gallery.isFetchingNextPage}
        />
      )}
    </section>
  );
}
