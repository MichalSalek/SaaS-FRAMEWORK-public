// UI/features/admin/AdminAnnouncementsPage.composition.tsx
// Admin Announcements: status tiles that filter the table, the table, and the
// create / edit, preview and delete dialogs.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { MegaphoneIcon, PlusIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import {
  StatTileBandMolecule,
  StatTileMolecule,
} from '../../components/StatTile/StatTile.molecule';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { useAdminAnnouncements } from './hooks/useAdminAnnouncements';
import type { AdminAnnouncement } from './hooks/useAdminAnnouncements';
import { useCreateAnnouncement } from './hooks/useCreateAnnouncement';
import { useUpdateAnnouncement } from './hooks/useUpdateAnnouncement';
import { useDeleteAnnouncement } from './hooks/useDeleteAnnouncement';
import { AnnouncementsTableOrganism } from './components/AnnouncementsTable.organism';
import { AnnouncementCreateEditDialogOrganism } from './components/AnnouncementCreateEditDialog.organism';
import type { AnnouncementSubmitPayload } from './components/announcement-form.utils';
import { AnnouncementPreviewDialogMolecule } from './components/AnnouncementPreviewDialog.molecule';
import { AdminConfirmDeleteDialogMolecule } from './components/AdminConfirmDeleteDialog.molecule';
import {
  ANNOUNCEMENT_STATUSES,
  deriveStatus,
} from './components/announcement-status.helpers';
import type { DerivedAnnouncementStatus } from './components/announcement-status.helpers';
import styles from './AdminAnnouncementsPage.module.css';

const STATUS_TILE_LABEL_KEY = {
  active: 'tileActive',
  scheduled: 'tileScheduled',
  draft: 'tileDraft',
  expired: 'tileExpired',
} as const satisfies Record<DerivedAnnouncementStatus, string>;

export function AdminAnnouncementsPageComposition() {
  const t = useTranslations('admin.announcements');
  const { announcements, isLoading, isFetching, isError, refetch } =
    useAdminAnnouncements();
  const createAnnouncement = useCreateAnnouncement();
  const updateAnnouncement = useUpdateAnnouncement();
  const deleteAnnouncement = useDeleteAnnouncement();

  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [editingAnnouncement, setEditingAnnouncement] =
    useState<AdminAnnouncement | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [previewAnnouncement, setPreviewAnnouncement] =
    useState<AdminAnnouncement | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<AdminAnnouncement | null>(
    null
  );
  const [statusFilter, setStatusFilter] =
    useState<DerivedAnnouncementStatus | null>(null);

  const openCreate = () => {
    setFormError(null);
    setEditingAnnouncement(null);
    setEditDialogOpen(true);
  };

  const openEdit = (ann: AdminAnnouncement) => {
    setFormError(null);
    setPreviewAnnouncement(null);
    setEditingAnnouncement(ann);
    setEditDialogOpen(true);
  };

  const closeEditDialog = () => {
    setEditDialogOpen(false);
    setEditingAnnouncement(null);
    setFormError(null);
  };

  const handleSubmit = (payload: AnnouncementSubmitPayload) => {
    setFormError(null);
    if (payload.kind === 'create') {
      createAnnouncement.mutate(payload.data, {
        onSuccess: () => {
          closeEditDialog();
          pushNewSnackbar(t('createSuccess'));
        },
        onError: () => setFormError(t('createError')),
      });
    } else {
      updateAnnouncement.mutate(payload.data, {
        onSuccess: () => {
          closeEditDialog();
          pushNewSnackbar(t('updateSuccess'));
        },
        onError: () => setFormError(t('updateError')),
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (!deleteTarget) {
      return;
    }
    deleteAnnouncement.mutate(
      { id: deleteTarget.id },
      {
        onSuccess: () => {
          setDeleteTarget(null);
          pushNewSnackbar(t('deleteSuccess'));
        },
        onError: () => {
          setDeleteTarget(null);
          pushNewSnackbar(t('deleteError'), 'error');
        },
      }
    );
  };

  // Nothing confirmed to show: never read, or an EMPTY last read under a
  // failed refresh (TQ v5 keeps it). Error with retry, no zero tiles, no
  // "no announcements yet" state.
  const listUnknown =
    announcements === null || (isError && announcements.length === 0);
  const all = announcements ?? [];
  const hasNone = !isLoading && !listUnknown && all.length === 0;

  // The tiles count with the same rule the table filters by.
  const byStatus = (status: DerivedAnnouncementStatus) =>
    all.filter(ann => deriveStatus(ann) === status);
  const rows = statusFilter === null ? all : byStatus(statusFilter);

  const loadError = {
    message: t('loadError'),
    retryLabel: t('retry'),
    onRetry: () => void refetch(),
    isRetrying: isFetching,
  };

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('eyebrow')}
      title={t('pageTitle')}
      subtitle={t('pageSubtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='primary'
          icon={<PlusIcon size={14} weight='bold' />}
          onClick={openCreate}>
          {t('createButton')}
        </ButtonAtom>
      }>
      {hasNone ? (
        // No announcements at all: said once, without a row of zero tiles.
        <EmptyStateAtom
          size='page'
          icon={<MegaphoneIcon size={40} />}
          title={t('emptyTitle')}
          titleAs='h2'
          description={t('emptyDescription')}
          action={
            <ButtonAtom size='md' variant='outlined' onClick={openCreate}>
              {t('createButton')}
            </ButtonAtom>
          }
        />
      ) : (
        <div className={styles.page}>
          {/* A failed refresh after a save keeps the last list below. */}
          {isError && !isLoading && !listUnknown && (
            <ErrorStateMolecule size='inline' {...loadError} />
          )}
          {!(isError && listUnknown) && (
            <StatTileBandMolecule ariaLabel={t('statusFilterAriaLabel')}>
              {ANNOUNCEMENT_STATUSES.map(status => (
                <StatTileMolecule
                  key={status}
                  label={t(STATUS_TILE_LABEL_KEY[status])}
                  value={byStatus(status).length}
                  loading={isLoading || listUnknown}
                  selected={statusFilter === status}
                  onSelect={() =>
                    setStatusFilter(current =>
                      current === status ? null : status
                    )
                  }
                />
              ))}
            </StatTileBandMolecule>
          )}
          <AnnouncementsTableOrganism
            announcements={rows}
            state={
              isLoading
                ? 'loading'
                : listUnknown
                  ? 'error'
                  : rows.length === 0
                    ? 'empty'
                    : 'ready'
            }
            empty={
              <EmptyStateAtom
                title={t('emptyFilteredTitle')}
                titleAs='h2'
                description={t('emptyFilteredDescription')}
                action={
                  <ButtonAtom
                    size='md'
                    variant='outlined'
                    onClick={() => setStatusFilter(null)}>
                    {t('showAll')}
                  </ButtonAtom>
                }
              />
            }
            error={loadError}
            onPreview={setPreviewAnnouncement}
            onEdit={openEdit}
            onDelete={setDeleteTarget}
          />
        </div>
      )}

      <AnnouncementCreateEditDialogOrganism
        open={editDialogOpen}
        editing={editingAnnouncement}
        isSubmitting={
          createAnnouncement.isPending || updateAnnouncement.isPending
        }
        errorMessage={formError}
        onSubmit={handleSubmit}
        onCancel={closeEditDialog}
      />

      <AnnouncementPreviewDialogMolecule
        open={previewAnnouncement !== null}
        announcement={previewAnnouncement}
        onClose={() => setPreviewAnnouncement(null)}
        onEdit={openEdit}
      />

      <AdminConfirmDeleteDialogMolecule
        open={deleteTarget !== null}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: deleteTarget?.title ?? '' })}
        confirmLabel={t('deleteConfirm')}
        cancelLabel={t('cancel')}
        isDeleting={deleteAnnouncement.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteTarget(null)}
      />
    </AdminPageLayoutComposition>
  );
}
