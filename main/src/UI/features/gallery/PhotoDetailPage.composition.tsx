import { useState, useEffect } from 'react';
import dynamic from 'next/dynamic';
import { useTranslations } from 'next-intl';
import { AppLayoutComposition } from '../../layouts/AppLayout.composition';
import { useNativeRouter } from '../../layouts/useNativeRouter';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { useAppBarTitle } from '../../layouts/useAppBarTitle.composition';
import { useCurrentUserAccount } from '../../shared/hooks/useCurrentUserAccount';
import { useAppRole } from '../../layouts/useAppRole';
import { ClientViewerActionsComposition } from './components/ClientViewerActions.composition';
import { useMaxScreenBrightness } from '../../shared/hooks/useMaxScreenBrightness';
import { usePhotoDetail } from '../shared/gallery/hooks/usePhotoDetail';
import { useTogglePin } from '../shared/gallery/hooks/useTogglePin';
import { useToggleLike } from './hooks/useToggleLike';
import { useDeleteGalleryRecord } from './hooks/useDeleteGalleryRecord';
import { useStylistGallery } from '../shared/gallery/hooks/useStylistGallery';
import { trackFlowStep } from '../../../application/analytics/flow-events';
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
  OwnerDeleteActionMolecule,
  ViewerActionsMolecule,
} from './PhotoDetailActions.molecule';
import type { NailLength } from '@kernel/domain/gallery/nail-length.config';
import { OutcomeStateMolecule } from '../../components/OutcomeFeedback/OutcomeState.molecule';
import styles from './PhotoDetailPage.module.css';

const ReportModal = dynamic(
  () =>
    import('../shared/moderation/components/ReportModal.organism').then(m => ({
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
  // A single-work screen is a colour exhibit: a dimmed screen shifts the polish
  // shade, the one thing the client comes here to see.
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
  // The session action reads the client's sessions and pairs, so it mounts
  // only once the role is KNOWN to be the client (an unknown role is not one).
  const appRole = useAppRole();
  const isClientViewer =
    isLoggedIn && appRole.isRoleResolved && appRole.role === 'client';
  const [reportOpen, setReportOpen] = useState(false);
  const [reportedIds, setReportedIds] = useState<ReadonlySet<string>>(
    new Set()
  );
  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [editOpen, setEditOpen] = useState(false);
  // Counts confirmed edits of this visit; 0 = nothing to acknowledge.
  const [editSavedCount, setEditSavedCount] = useState(0);
  const tOutcome = useTranslations('components.outcomeFeedback');
  const tLabels = useTranslations('labels');
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
   * The hook is ALWAYS called (Rules of Hooks), but the query is gated by `enabled:
   * accountId.length > 0` in useStylistGallery: with an empty stylistAccountId no fetch fires and
   * `allRecords` is a stable empty array. Rendering SimilarSection below is gated by
   * `stylistAccountId` too, to avoid needless work (e.g. its useMemo) on an empty id. */
  const stylistAccountId = data?.stylist_info.account_id ?? '';
  const { allRecords: stylistRecords } = useStylistGallery(stylistAccountId);

  // `||`, not `??`: a stylist onboarded with the role alone has an empty name,
  // which must reach the fallbacks below like a missing one.
  const displayName =
    data?.stylist_info.display_name || data?.stylist_info.business_name || null;
  // Her own photo: the bar names the screen. Her own name up there read as
  // somebody else's („reads like a client's name, though it is mine”, two of
  // two first-time readers, 2026-10-10). A viewer sees whose work it is.
  useAppBarTitle(
    isOwner ? t('photoDetailTitle') : (displayName ?? t('photoDetailTitle'))
  );

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

  const { gallery_record, is_favorited, is_pinned } = data;

  const shareTitle = displayName
    ? t('photoShareTitle', { name: displayName })
    : t('photoDetailTitle');
  const stylistDisplayName = displayName ?? tLabels('stylistFallback');
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
          nav.back();
        },
        // Optimistic rollback is owned by the hook's onError; the error TOAST is
        // owned by the HTTP interceptor (event-bus Stage 1: backend gallery event or
        // INTERNET_CONNECTION_PROBLEM). No call-site onError — a local toast stacked
        // a duplicate (raw-input dedup never collapses a different key).
      }
    );
  };

  const viewerProps = {
    isFavorited: is_favorited,
    isLikePending: likeMutation.isPending,
    onToggleLike: handleToggleLike,
    shareUrl,
    shareTitle,
    showReport: isHydrated && isLoggedIn,
    isReported: reportedIds.has(photoId),
    onReport: () => setReportOpen(true),
  };
  const viewerActions =
    isHydrated && isClientViewer ? (
      <ClientViewerActionsComposition
        {...viewerProps}
        stylistAccountId={stylistAccountId}
        photoId={photoId}
      />
    ) : (
      <ViewerActionsMolecule {...viewerProps} />
    );

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
                shareUrl={shareUrl}
                shareTitle={shareTitle}
                onShared={channel => {
                  if (channel !== false) {
                    trackFlowStep('photo', 'shared', { channel });
                  }
                }}
                onTogglePin={handleTogglePin}
                onEdit={handleOpenEdit}
              />
            ) : (
              viewerActions
            )}

            <PhotoCreditMolecule
              // Her own photo needs no credit line.
              stylistDisplayName={isOwner ? null : stylistDisplayName}
              createdAt={gallery_record.created_at}
              nailLengthLabel={nailLengthLabel}
            />

            <PhotoDetailGroupsMolecule
              traits={gallery_record.traits}
              colors={gallery_record.colors}
            />

            {isOwner && (
              <OutcomeStateMolecule
                confirmed={editSavedCount > 0}
                completionKey={editSavedCount}
                message={tOutcome('saveDone')}
              />
            )}

            {isOwner && <OwnerDeleteActionMolecule onDelete={handleDelete} />}
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
        onSaved={() => setEditSavedCount(count => count + 1)}
        photoId={photoId}
        initialColorIds={editColorIds}
        initialTraitIds={editTraitIds}
        initialNailLength={editNailLength}
      />
    </div>
  );
}
