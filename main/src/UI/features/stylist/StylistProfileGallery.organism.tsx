import { useRef } from 'react';
import { useRouter } from 'next/router';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { useTranslations } from 'next-intl';
import { ImagesIcon } from '@phosphor-icons/react';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useIsStylist } from '../../shared/hooks/useSessionRole';
import { LinkButtonAtom } from '../../components/Button/LinkButton.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { useStylistGallery } from '../shared/gallery/hooks/useStylistGallery';
import { GalleryPhotoCardOrganism } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import type { GalleryRecordView } from '../../components/GalleryPhotoCard/GalleryPhotoCard.organism';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { TypographyAtom } from '../../components/Typography/Typography.atom';
import { StylistProfileGalleryFiltersOrganism } from './StylistProfileGalleryFilters.organism';
import { AppDialogAtom } from '../../primitives/AppDialog.atom';
import { ShareButtonAtom } from '../../components/ShareButton/ShareButton.atom';
import { publicProfilePhotoShareUrl } from './_profile-share.helpers';
import styles from './StylistProfilePage.module.css';

const LENGTH_LABEL_KEYS: Record<
  NailLength,
  'short' | 'medium' | 'long' | 'xl'
> = {
  SHORT: 'short',
  MEDIUM: 'medium',
  LONG: 'long',
  XL: 'xl',
};

interface StylistProfileGalleryProps {
  accountId: string;
  /** The stylist's non-hidden works (public portfolio size, counted in the DB); see the DECISION below. */
  galleryRecordsCount: number;
}

export function StylistProfileGalleryOrganism({
  accountId,
  galleryRecordsCount,
}: StylistProfileGalleryProps) {
  const t = useTranslations('stylist.gallery');
  const tGallery = useTranslations('pages.gallery');
  const tButtons = useTranslations('buttons');
  const router = useRouter();
  const tCard = useTranslations('galleryCard');
  const tFilter = useTranslations('galleryFilter');
  const galleryRef = useRef<HTMLDivElement>(null);
  const photoTriggerRef = useRef<HTMLElement | null>(null);
  const selectedId =
    typeof router.query.photo === 'string' ? router.query.photo : null;
  const setPhoto = (id: string | null) => {
    const query = { ...router.query };
    if (id === null) {
      delete query.photo;
    } else {
      query.photo = id;
    }
    // Preserve the displayed pathname, including its trailing slash. The content shell
    // keys by that path; normalizing it while opening a photo remounts the portfolio.
    const display = new URL(router.asPath, window.location.origin);
    if (id === null) {
      display.searchParams.delete('photo');
    } else {
      display.searchParams.set('photo', id);
    }
    void router.replace(
      { pathname: router.pathname, query },
      `${display.pathname}${display.search}${display.hash}`,
      { shallow: true, scroll: false }
    );
  };
  const gallery = useStylistGallery(accountId);
  const {
    allRecords,
    isLoading,
    isError,
    isFetching,
    hasData,
    refetch,
    showWatermark,
  } = gallery;
  // Same query key as the page's own read, so this costs no request. Own
  // profile = the viewer's stylist account is the account on screen.
  const { data: viewer } = useCurrentUserAccount();
  const isOwnProfile = viewer?.stylist_account?.account_id === accountId;
  const isStylistMode = useIsStylist();

  // DECISION: offer EVERY pinned record the backend returns, no client-side cap: the only
  // numeric ceiling is the plan's pin limit (publicGetGalleryRecordsByAccount_IO), otherwise
  // the sold pin ladder collapses and Studio looks like Free. `is_pinned: false` is deliberate:
  // every record here is pinned, so a pin badge on each tile would be noise. Public filters
  // narrow that same set locally; they never request or reveal unpinned photos.
  const previewRecords: GalleryRecordView[] = gallery.filteredRecords.map(
    r => ({
      ...r,
      is_pinned: false,
    })
  );

  if (isLoading) {
    // Four placeholder tiles in the same responsive grid as the works and in the 3:4 tile ratio, so the
    // arriving records do not shift the rest of the page. Four is the placeholder
    // count, NOT the gallery ceiling: that lives in the plan (the DECISION above).
    return (
      <section className={styles.section} aria-busy='true' aria-live='polite'>
        <SkeletonAtom variant='text' width='55%' height={24} />
        <div className={styles.galleryGrid}>
          {[0, 1, 2, 3].map(i => (
            <SkeletonAtom
              key={i}
              variant='rect'
              width='100%'
              height={0}
              className={styles.skeletonPhoto}
            />
          ))}
        </div>
      </section>
    );
  }

  // A failed read ≠ an empty gallery: without this branch a network failure rendered
  // „Portfolio jeszcze puste" under a profile that has works. Stale data after a
  // failed background refresh stays on screen (the branch is only for no data,
  // so a really empty gallery after a failed refresh stays an empty state).
  if (isError && !hasData) {
    return (
      <section className={styles.section}>
        <ErrorStateMolecule
          message={tGallery('loadError')}
          retryLabel={tButtons('retry')}
          onRetry={() => void refetch()}
          isRetrying={isFetching}
        />
      </section>
    );
  }

  // The empty state after a REALLY loaded gallery, not after the profile's counter:
  // with a mismatch (cached count > 0, zero public records) the heading
  // promised N works above an empty grid.
  //
  // DECISION: this is an empty PUBLIC PIN set. A visitor sees no private gallery
  // information. An owner in stylist mode can add her first work or pin an existing one.
  if (!isLoading && allRecords.length === 0) {
    return (
      <section className={styles.section}>
        <EmptyStateAtom
          icon={<ImagesIcon size={28} />}
          title={t('empty')}
          titleAs='h2'
          {...(isOwnProfile
            ? {
                description: t(
                  galleryRecordsCount > 0
                    ? 'ownerUnpinnedDesc'
                    : 'ownerEmptyDesc'
                ),
              }
            : {})}
          {...(isOwnProfile && isStylistMode
            ? {
                action: (
                  <LinkButtonAtom
                    href={
                      galleryRecordsCount > 0
                        ? ROUTES_FRONT.GALLERY
                        : ROUTES_FRONT.GALLERY_UPLOAD_ASSET
                    }
                    variant='primary'
                    size='md'
                    direction='forward'>
                    {t(
                      galleryRecordsCount > 0
                        ? 'ownerUnpinnedCta'
                        : 'ownerEmptyCta'
                    )}
                  </LinkButtonAtom>
                ),
              }
            : {})}
        />
      </section>
    );
  }

  // DECISION: the heading counts the complete public pinned set; the filter row counts matches.
  // „+ jeszcze N” is the rest of the visible portfolio, never excluded filter matches. Filtering
  // must not make public pins appear to require a connection. The endpoint's `total_count`
  // stays unused: it is capped by the plan ceiling (see DECISION in useStylistGallery).
  // A deep link can only open a record in this public pinned response.
  const selectedRecord = allRecords.find(
    r => r.gallery_record_id === selectedId
  );
  const featuredCount = allRecords.length;
  const moreCount = Math.max(0, galleryRecordsCount - featuredCount);

  return (
    <section className={styles.section}>
      <StylistProfileGalleryFiltersOrganism gallery={gallery}>
        <TypographyAtom variant='h2' className={styles.sectionTitle}>
          {/* A data counter in a serif heading → sans tabular (global .data-count;
           * Marcellus renders „10" like „1O"). The <dataCount> tag lives in i18n:
           * without the tag in the message t.rich renders the counter without a wrapper (graceful). */}
          {t.rich('featuredCount', {
            count: featuredCount,
            dataCount: chunks => <span className='data-count'>{chunks}</span>,
          })}
        </TypographyAtom>
      </StylistProfileGalleryFiltersOrganism>
      {previewRecords.length === 0 && (
        <EmptyStateAtom
          title={tGallery('noFilterResults')}
          titleAs='p'
          role='status'
        />
      )}
      <div ref={galleryRef} className={styles.galleryGrid}>
        {previewRecords.map(record => (
          <GalleryPhotoCardOrganism
            key={record.gallery_record_id}
            record={record}
            compact
            showHeart={false}
            showWatermark={showWatermark}
            onCardClick={() => {
              // The router may move focus before the dialog mounts. Remember the actual
              // photo button, including for pointer clicks that do not focus it.
              const tile = Array.from(
                galleryRef.current?.querySelectorAll<HTMLElement>(
                  '[data-gallery-record-id]'
                ) ?? []
              ).find(
                element =>
                  element.dataset.galleryRecordId === record.gallery_record_id
              );
              photoTriggerRef.current = tile?.querySelector('button') ?? null;
              setPhoto(record.gallery_record_id);
            }}
          />
        ))}
      </div>
      <AppDialogAtom
        open={Boolean(selectedRecord)}
        onOpenChange={open => {
          if (!open) {
            setPhoto(null);
          }
        }}>
        <AppDialogAtom.Content
          title={tCard('altFallback')}
          finalFocus={() =>
            photoTriggerRef.current?.isConnected
              ? photoTriggerRef.current
              : true
          }>
          {selectedRecord && (
            <AppDialogAtom.Body>
              <GalleryPhotoCardOrganism
                record={{ ...selectedRecord, is_pinned: false }}
                showWatermark={showWatermark}
              />
              {selectedRecord.nail_length && (
                <p className={styles.photoLength}>
                  {tFilter('nailLengthLabel')}:{' '}
                  {tCard(
                    `nailLength.${LENGTH_LABEL_KEYS[selectedRecord.nail_length]}`
                  )}
                </p>
              )}
              <ShareButtonAtom
                url={
                  typeof window === 'undefined'
                    ? ''
                    : publicProfilePhotoShareUrl(
                        window.location,
                        selectedRecord.gallery_record_id
                      )
                }
                title={tCard('altFallback')}
                label={tCard('share')}
              />
            </AppDialogAtom.Body>
          )}
        </AppDialogAtom.Content>
      </AppDialogAtom>
      {moreCount > 0 && (
        <TypographyAtom variant='caption' className={styles.galleryMore}>
          {t('moreWorks', { count: moreCount })}
        </TypographyAtom>
      )}
    </section>
  );
}
