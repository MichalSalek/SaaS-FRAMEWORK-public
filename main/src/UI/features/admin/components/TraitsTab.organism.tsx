// admin/components/TraitsTab.organism.tsx
// Traits tab: the dictionary grouped by category (one list per category, the
// category named once above it), a form dialog for create and edit, a
// confirmation for delete.

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { TagIcon } from '@phosphor-icons/react';
import { TRAIT_CATEGORIES } from '@kernel/domain/admin/traits.config';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { EmptyStateAtom } from '../../../components/EmptyState/EmptyState.atom';
import { ErrorStateMolecule } from '../../../components/ErrorState/ErrorState.molecule';
import { NavRowListMolecule } from '../../../components/NavRow/NavRow.molecule';
import { pushNewSnackbar } from '../../../../application/app-snackbar/appSnackbar.possibilities.api';
import {
  TraitRowMolecule,
  TRAIT_CATEGORY_LABEL_KEY,
} from './TraitRow.molecule';
import { TraitFormDialogOrganism } from './TraitFormDialog.organism';
import type { TraitFormData } from './TraitFormDialog.organism';
import { AdminConfirmDeleteDialogMolecule } from './AdminConfirmDeleteDialog.molecule';
import { TaxonomyListSkeletonMolecule } from './TaxonomyListSkeleton.molecule';
import { useAdminTraits } from '../hooks/useAdminTraits';
import type { AdminTrait } from '../hooks/useAdminTraits';
import { useCreateTrait } from '../hooks/useCreateTrait';
import { useUpdateTrait } from '../hooks/useUpdateTrait';
import { useDeleteTrait } from '../hooks/useDeleteTrait';

interface TraitsTabProps {
  /** The page's main action („Dodaj cechę”) asked for the create form. */
  createOpen: boolean;
  onCreateOpen: () => void;
  onCreateClose: () => void;
}

export function TraitsTabOrganism({
  createOpen,
  onCreateOpen,
  onCreateClose,
}: TraitsTabProps) {
  const t = useTranslations('admin.colorsTraits');
  const tButtons = useTranslations('buttons');
  const { traits, isLoading, isFetching, isError, refetch } = useAdminTraits();
  const createTrait = useCreateTrait();
  const updateTrait = useUpdateTrait();
  const deleteTrait = useDeleteTrait();

  const [editing, setEditing] = useState<AdminTrait | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [pendingDelete, setPendingDelete] = useState<AdminTrait | null>(null);

  const closeForm = () => {
    setEditing(null);
    setFormError(null);
    onCreateClose();
  };

  const handleSubmit = (data: TraitFormData) => {
    setFormError(null);
    if (editing !== null) {
      updateTrait.mutate(
        { trait_id: editing.id, ...data },
        {
          onSuccess: () => {
            closeForm();
            pushNewSnackbar(t('traitUpdateSuccess'), 'success');
          },
          onError: () => setFormError(t('traitUpdateError')),
        }
      );
      return;
    }
    createTrait.mutate(data, {
      onSuccess: () => {
        closeForm();
        pushNewSnackbar(t('traitAddSuccess'), 'success');
      },
      onError: () => setFormError(t('traitAddError')),
    });
  };

  const handleConfirmDelete = () => {
    if (pendingDelete === null) {
      return;
    }
    deleteTrait.mutate(
      { trait_id: pendingDelete.id },
      {
        onSuccess: () => {
          setPendingDelete(null);
          pushNewSnackbar(t('traitDeleteSuccess'), 'success');
        },
        onError: () => {
          setPendingDelete(null);
          pushNewSnackbar(t('traitDeleteError'), 'error');
        },
      }
    );
  };

  const loadError = (size: 'card' | 'inline') => (
    <ErrorStateMolecule
      size={size}
      message={t('traitsLoadError')}
      retryLabel={tButtons('retry')}
      onRetry={() => void refetch()}
      isRetrying={isFetching}
    />
  );

  let content;
  if (isLoading) {
    content = <TaxonomyListSkeletonMolecule />;
  } else if (isError && (traits === null || traits.length === 0)) {
    // An EMPTY last read under a failed refresh is unconfirmed: same error.
    content = loadError('card');
  } else if (traits === null || traits.length === 0) {
    content = (
      <EmptyStateAtom
        icon={<TagIcon size={28} />}
        title={t('traitsEmptyTitle')}
        titleAs='h2'
        description={t('traitsEmptyDescription')}
        action={
          <ButtonAtom size='md' variant='outlined' onClick={onCreateOpen}>
            {t('addTrait')}
          </ButtonAtom>
        }
      />
    );
  } else {
    content = (
      <div>
        {/* A failed refresh after a change keeps the last list below. */}
        {isError && loadError('inline')}
        {TRAIT_CATEGORIES.map(category => {
          const inCategory = traits.filter(
            trait => trait.category === category
          );
          if (inCategory.length === 0) {
            return null;
          }
          return (
            <NavRowListMolecule
              key={category}
              label={t(TRAIT_CATEGORY_LABEL_KEY[category])}>
              {inCategory.map(trait => (
                <TraitRowMolecule
                  key={trait.id}
                  trait={trait}
                  onEdit={setEditing}
                  onDelete={setPendingDelete}
                />
              ))}
            </NavRowListMolecule>
          );
        })}
      </div>
    );
  }

  return (
    <>
      {content}

      <TraitFormDialogOrganism
        open={createOpen || editing !== null}
        editing={editing}
        isSaving={createTrait.isPending || updateTrait.isPending}
        errorMessage={formError}
        onSubmit={handleSubmit}
        onCancel={closeForm}
      />

      <AdminConfirmDeleteDialogMolecule
        open={pendingDelete !== null}
        title={t('traitDeleteConfirmTitle')}
        message={t('traitDeleteConfirm', { name: pendingDelete?.name ?? '' })}
        confirmLabel={t('menuDelete')}
        cancelLabel={t('cancel')}
        isDeleting={deleteTrait.isPending}
        onConfirm={handleConfirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </>
  );
}
