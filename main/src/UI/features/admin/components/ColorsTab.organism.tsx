// admin/components/ColorsTab.organism.tsx
// Colours tab: the palette as one list, a form dialog for create and edit,
// a confirmation for delete.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { PaintBrushIcon } from '@phosphor-icons/react';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { NavRowListMolecule } from '../../../components/NavRow/NavRow.molecule';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { ColorRowMolecule } from './ColorRow.molecule';
import { ColorFormDialogOrganism } from './ColorFormDialog.organism';
import type { ColorFormData } from './ColorFormDialog.organism';
import { AdminConfirmDeleteDialogMolecule } from './AdminConfirmDeleteDialog.molecule';
import { TaxonomyListSkeletonMolecule } from './TaxonomyListSkeleton.molecule';
import { useAdminColors } from '../hooks/useAdminColors';
import type { AdminColor } from '../hooks/useAdminColors';
import { useCreateColor } from '../hooks/useCreateColor';
import { useUpdateColor } from '../hooks/useUpdateColor';
import { useDeleteColor } from '../hooks/useDeleteColor';

interface ColorsTabProps {
  /** The page's main action („Dodaj kolor”) asked for the create form. */
  createOpen: boolean;
  onCreateOpen: () => void;
  onCreateClose: () => void;
}

export function ColorsTabOrganism({
  createOpen,
  onCreateOpen,
  onCreateClose,
}: ColorsTabProps) {
  const t = useTranslations('admin.colorsTraits');
  const tButtons = useTranslations('buttons');
  const { colors, isLoading, isFetching, isError, refetch } = useAdminColors();
  const createColor = useCreateColor();
  const updateColor = useUpdateColor();
  const deleteColor = useDeleteColor();

  const [editing, setEditing] = useState<AdminColor | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminColor | null>(null);

  const closeForm = () => {
    setEditing(null);
    setFormError(null);
    onCreateClose();
  };

  const handleSubmit = (data: ColorFormData) => {
    setFormError(null);
    if (editing !== null) {
      updateColor.mutate(
        { color_id: editing.id, ...data },
        {
          onSuccess: () => {
            closeForm();
            pushNewSnackbar(t('colorUpdateSuccess'), 'success');
          },
          onError: () => setFormError(t('colorUpdateError')),
        }
      );
      return;
    }
    createColor.mutate(data, {
      onSuccess: () => {
        closeForm();
        pushNewSnackbar(t('colorAddSuccess'), 'success');
      },
      onError: () => setFormError(t('colorAddError')),
    });
  };

  const handleConfirmDelete = () => {
    if (pendingDelete === null) {
      return;
    }
    deleteColor.mutate(
      { color_id: pendingDelete.id },
      {
        onSuccess: () => {
          setPendingDelete(null);
          pushNewSnackbar(t('colorDeleteSuccess'), 'success');
        },
        onError: () => {
          setPendingDelete(null);
          pushNewSnackbar(t('colorDeleteError'), 'error');
        },
      }
    );
  };

  const loadError = (size: 'card' | 'inline') => (
    <ErrorStateMolecule
      size={size}
      message={t('colorsLoadError')}
      retryLabel={tButtons('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  );

  let content;
  if (isLoading) {
    content = <TaxonomyListSkeletonMolecule withSwatch />;
  } else if (isError && (colors === null || colors.length === 0)) {
    // An EMPTY last read under a failed refresh is unconfirmed: same error.
    content = loadError('card');
  } else if (colors === null || colors.length === 0) {
    content = (
      <EmptyStateAtom
        icon={<PaintBrushIcon size={28} />}
        title={t('colorsEmptyTitle')}
        titleAs='h2'
        description={t('colorsEmptyDescription')}
        action={
          <ButtonAtom size='md' variant='outlined' onClick={onCreateOpen}>
            {t('addColor')}
          </ButtonAtom>
        }
      />
    );
  } else {
    content = (
      <>
        {/* A failed refresh after a change keeps the last list below. */}
        {isError && loadError('inline')}
        <NavRowListMolecule ariaLabel={t('tabColors')}>
          {colors.map(color => (
            <ColorRowMolecule
              key={color.id}
              color={color}
              onEdit={setEditing}
              onDelete={setPendingDelete}
            />
          ))}
        </NavRowListMolecule>
      </>
    );
  }

  return (
    <>
      {content}

      <ColorFormDialogOrganism
        open={createOpen || editing !== null}
        editing={editing}
        isSaving={createColor.isPending || updateColor.isPending}
        errorMessage={formError}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      />

      <AdminConfirmDeleteDialogMolecule
        open={pendingDelete !== null}
        title={t('colorDeleteConfirmTitle')}
        message={t('colorDeleteConfirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('menuDelete')}
        cancelLabel={t('cancel')}
        isDeleting={deleteColor.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
