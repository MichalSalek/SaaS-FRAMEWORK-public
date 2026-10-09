import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useMaxScreenBrightness } from '../../shared/hooks/useMaxScreenBrightness';
import { usePhotoDetail } from '../shared/gallery/hooks/usePhotoDetail';
import { useTogglePin } from '../shared/gallery/hooks/useTogglePin';
import { useToggleLike } from './hooks/useToggleLike';
import { useDeleteGalleryRecord } from './hooks/useDeleteGalleryRecord';
import { useStylistGallery } from '../shared/gallery/hooks/useStylistGallery';
import { shareContent } from '../../../application/platform/share';
import { SimilarSectionOrganism } from './components/SimilarSection.organism';
import { PhotoDetailEditModalComposition } from './components/PhotoDetailEditModal.composition';
import {
  PhotoHeroStageOrganism,
  PhotoCreditMolecule,
  PhotoDetailGroupsMolecule,
  PhotoDetailSkeletonMolecule,
  PhotoDetailDeleteDialogComposition,
} from './PhotoDetailPage.parts.composition';
import {
  OwnerActionsMolecule,
  ViewerActionsMolecule,
} from './PhotoDetailActions.molecule';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import styles from './PhotoDetailPage.module.css';

const ReportModal = dynamic(
  () =>
    import('../moderation/components/ReportModal.organism').then(m => ({
      default: m.ReportModalOrganism,
    })),
  { ssr: false }
);

interface PhotoDetailPageProps {
  photoId: string;
}

export function PhotoDetailPageComposition({ photoId }: PhotoDetailPageProps) {
  const t = useTranslations('pages.gallery');
  return (
    <AppLayoutComposition title={t('photoDetailTitle')}>
      <PhotoDetailPageInner photoId={photoId} />
    </AppLayoutComposition>
  );
}

function PhotoDetailPageInner({ photoId }: PhotoDetailPageProps) {
  const t = useTranslations('pages.gallery');
  // Ekran pojedynczej pracy = ekspozycja koloru: przygaszony ekran zmienia
  // odcień lakieru, a to jedyna rzecz, po którą tu wchodzi klientka.
  useMaxScreenBrightness();
  const nav = useNativeRouter();
  const {
    data,
    isLoading,
    isError,
    isNotFound,
    isRefetching,
    refetch,
    isOwner,
  } = usePhotoDetail(photoId);
  const pinMutation = useTogglePin(photoId);
  const likeMutation = useToggleLike(photoId);
  const deleteMutation = useDeleteGalleryRecord();
  const { data: currentUser } = useCurrentUserAccount();
  const isLoggedIn = currentUser != null;
  const [reportOpen, setReportOpen] = useState(false);
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  const [shareUrl, setShareUrl] = useState('');

  /* Edit modal seed values — pre-populated when modal opens */
  const [editColorIds, setEditColorIds] = useState<string[]>([]);
  const [editTraitIds, setEditTraitIds] = useState<string[]>([]);
  const [editNailLength, setEditNailLength] = useState<NailLength | null>(null);

  const handleOpenEdit = () => {
    if (!data) {
      return;
    }
    setEditColorIds(data.gallery_record.colors.map(c => c.id));
    setEditTraitIds(data.gallery_record.traits.map(tr => tr.id));
    setEditNailLength(data.gallery_record.nail_length);
    setEditOpen(true);
  };

  // SSR/CSR hydration guard — `isLoggedIn` derives from auth store (localStorage).
  // On the server it is always false (no window); on the client it may flip to true.
  // Rendering auth-conditional JSX before hydration completes causes a React
  // Hydration Error (server tree != client tree). We defer auth-dependent nodes
  // (Report button, ReportModal mount) until the first client-side effect has run.
  const [isHydrated, setIsHydrated] = useState(false);
  useEffect(() => {
    setIsHydrated(true);
  }, []);

  useEffect(() => {
    setShareUrl(window.location.href);
  }, []);

  /* Fetch stylist's gallery for "Similar" section.
   * DECISION (nie usuwaj tego komentarza):
   * Hook ZAWSZE wywolany (Rules of Hooks), ale query jest gated przez
   * `enabled: accountId.length > 0` w useStylistGallery — gdy stylistAccountId
   * jest pusty, fetch sie nie odpala, `allRecords` = stable empty array.
   * Renderowanie SimilarSection ponizej dodatkowo gated przez `stylistAccountId`,
   * by uniknac niepotrzebnych prac (np. SimilarSection useMemo) przy pustym ID. */
  const stylistAccountId = data?.stylist_info.account_id ?? '';
  const { allRecords: stylistRecords } = useStylistGallery(stylistAccountId);

  const displayName =
    data?.stylist_info.display_name ?? data?.stylist_info.business_name ?? null;
  useAppBarTitle(displayName ?? t('photoDetailTitle'));

  // Empty id = router not settled yet (query disabled, so `isLoading` is
  // false): that is „still loading", not „photo not found".
  if (isLoading || photoId === '') {
    return (
      <div className={styles.page}>
        <PhotoDetailSkeletonMolecule />
      </div>
    );
  }

  // Only a missing record is „not found". A network/server failure is „could
  // not load" with a retry, and a failed BACKGROUND refetch (e.g. after a pin
  // toggle) keeps the photo on screen: `data` wins over `isError`.
  if (!data && isError && !isNotFound) {
    return (
      <div className={styles.page}>
        <div className={styles.stateColumn}>
          <ErrorStateMolecule
            message={t('photoLoadError')}
            retryLabel={t('retry')}
            onRetry={() => void refetch()}
            isRetrying={isRefetching}
          />
          <ButtonAtom variant='outlined' size='sm' onClick={() => nav.back()}>
            {t('goBack')}
          </ButtonAtom>
        </div>
      </div>
    );
  }

  if (!data) {
    return (
      <div className={styles.page}>
        <EmptyStateAtom
          title={t('photoNotFound')}
          titleAs='h2'
          action={
            <ButtonAtom variant='outlined' size='md' onClick={() => nav.back()}>
              {t('goBack')}
            </ButtonAtom>
          }
        />
      </div>
    );
  }

  const { gallery_record, stylist_info, is_favorited, is_pinned } = data;

  const shareTitle = displayName
    ? t('photoShareTitle', { name: displayName })
    : t('photoDetailTitle');
  const stylistDisplayName =
    stylist_info.display_name ?? stylist_info.business_name ?? '—';
  // Klucze i18n pages.gallery.nailLength sa lowercase (long/medium/short/xl),
  // a enum NailLength jest UPPERCASE — bez toLowerCase() => MISSING_MESSAGE.
  const nailLengthLabel = t(
    `nailLength.${gallery_record.nail_length.toLowerCase()}`
  );
  const handleTogglePin = () => pinMutation.mutate(is_pinned);
  const handleToggleLike = () => likeMutation.mutate(is_favorited);
  const handleDelete = () => setDeleteConfirmOpen(true);
  const handleConfirmDelete = () => {
    deleteMutation.mutate(
      { gallery_record_id: photoId },
      {
        onSuccess: () => {
          setDeleteConfirmOpen(false);
          pushNewSnackbar(t('photoDeleted'), 'success');
          nav.back();
        },
        // Optimistic rollback is owned by the hook's onError; the error TOAST is
        // owned by the HTTP interceptor (event-bus Stage 1: backend gallery event or
        // INTERNET_CONNECTION_PROBLEM). No call-site onError — a local toast stacked
        // a duplicate (raw-input dedup never collapses a different key).
      }
    );
  };

  return (
    <div className={styles.page}>
      {/* Phone: photo, then the actions, then what the photo is. From 720px of
          the page's own width the photo keeps the left column and everything
          the person does or reads sits beside it. */}
      <PageColumnsMolecule
        asideSize='wide'
        main={
          <PhotoHeroStageOrganism
            assetUrl={gallery_record.asset_url}
            altText={t('photoDetailAlt')}
            isPinned={is_pinned}
          />
        }
        aside={
          <>
            {isOwner ? (
              <OwnerActionsMolecule
                isPinned={is_pinned}
                isPinPending={pinMutation.isPending}
                onShare={() =>
                  void shareContent({ title: shareTitle, url: shareUrl })
                }
                onTogglePin={handleTogglePin}
                onEdit={handleOpenEdit}
                onDelete={handleDelete}
              />
            ) : (
              <ViewerActionsMolecule
                isFavorited={is_favorited}
                isLikePending={likeMutation.isPending}
                onToggleLike={handleToggleLike}
                shareUrl={shareUrl}
                shareTitle={shareTitle}
                showReport={isHydrated && isLoggedIn}
                isReported={reportedIds.has(photoId)}
                onReport={() => setReportOpen(true)}
              />
            )}

            <PhotoCreditMolecule
              // Her own photo: the app bar already carries her name.
              stylistDisplayName={isOwner ? null : stylistDisplayName}
              createdAt={gallery_record.created_at}
              nailLengthLabel={nailLengthLabel}
            />

            <PhotoDetailGroupsMolecule
              traits={gallery_record.traits}
              colors={gallery_record.colors}
            />
          </>
        }
      />

      {/* Similar stylizations — gated by stylistAccountId AND records present */}
      {stylistAccountId !== '' && stylistRecords.length > 0 && (
        <SimilarSectionOrganism
          currentPhoto={data}
          allRecords={stylistRecords}
        />
      )}

      {/* Report modal — viewer-only, logged-in viewer.
       * Hydration gate prevents SSR/CSR tree mismatch since isLoggedIn
       * derives from client-only auth store. */}
      {isHydrated && !isOwner && isLoggedIn && (
        <ReportModal
          open={reportOpen}
          onClose={() => setReportOpen(false)}
          galleryRecordId={photoId}
          onSuccess={() => setReportedIds(prev => new Set([...prev, photoId]))}
        />
      )}

      {/* Delete confirmation dialog — owner-only */}
      <PhotoDetailDeleteDialogComposition
        open={deleteConfirmOpen}
        isPending={deleteMutation.isPending}
        // Escape used to close the dialog mid-delete, and the success handler
        // then navigated away from under a dialog that was no longer there.
        onClose={() => {
          if (!deleteMutation.isPending) {
            setDeleteConfirmOpen(false);
          }
        }}
        onConfirm={handleConfirmDelete}
      />

      {/* Edit modal — owner-only, pre-populated with current values */}
      <PhotoDetailEditModalComposition
        open={editOpen}
        onOpenChange={setEditOpen}
        photoId={photoId}
        initialColorIds={editColorIds}
        initialTraitIds={editTraitIds}
        initialNailLength={editNailLength}
      />
    </div>
  );
}
