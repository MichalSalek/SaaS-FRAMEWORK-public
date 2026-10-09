// admin/components/TraitFormDialog.organism.tsx
// Create / edit one trait (a technique, a finish, a decoration, a style).

import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import type { TraitCategory } from '@kernel/models/db_models.manual.dto';
import { TRAIT_CATEGORIES } from '@kernel/domain/admin/traits.config';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SelectAtom } from '../../../components/Select/Select.atom';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { confirmDiscardIfDirty } from '../../../../application/routing/leave-guard';
import type { AdminTrait } from '../hooks/useAdminTraits';
import { TRAIT_CATEGORY_LABEL_KEY } from './TraitRow.molecule';
import styles from '../AdminColorsTraitsPage.module.css';

const DEFAULT_CATEGORY: TraitCategory = 'technique';

function isTraitCategory(value: string): value is TraitCategory {
  return TRAIT_CATEGORIES.some(category => category === value);
}

export interface TraitFormData {
  name: string;
  category: TraitCategory;
}

interface TraitFormDialogProps {
  open: boolean;
  /** `null` = a new trait. */
  editing: AdminTrait | null;
  isSaving: boolean;
  /** The last save failed: shown next to the buttons until the next try. */
  errorMessage: string | null;
  onSubmit: (data: TraitFormData) => void;
  onCancel: () => void;
}

export function TraitFormDialogOrganism({
  open,
  editing,
  isSaving,
  errorMessage,
  onSubmit,
  onCancel,
}: TraitFormDialogProps) {
  const t = useTranslations('admin.colorsTraits');
  const formId = useId();
  const [name, setName] = useState('');
  const [category, setCategory] = useState<TraitCategory>(DEFAULT_CATEGORY);
  const [touched, setTouched] = useState(false);
  // Frozen while the dialog is open: the title must not flip to „new” while
  // the dialog of a finished edit is still closing.
  const [isEdit, setIsEdit] = useState(false);

  const initialName = editing?.name ?? '';
  const initialCategory = editing?.category ?? DEFAULT_CATEGORY;

  // Reset whenever the dialog (re)opens or its target changes.
  useEffect(() => {
    if (!open) {
      return;
    }
    setName(initialName);
    setCategory(initialCategory);
    setTouched(false);
    setIsEdit(editing !== null);
  }, [open, editing, initialName, initialCategory]);

  const isNameValid = name.trim().length > 0;
  const isDirty =
    open && (name !== initialName || category !== initialCategory);
  useLeaveGuard({ when: isDirty, message: t('discardDraftConfirm') });

  const requestClose = () => {
    if (isSaving) {
      return;
    }
    void confirmDiscardIfDirty(isDirty, t('discardDraftConfirm')).then(
      discard => {
        if (discard) {
          onCancel();
        }
      }
    );
  };

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setTouched(true);
    if (!isNameValid || isSaving) {
      return;
    }
    onSubmit({ name: name.trim(), category });
  };

  return (
    <AppDialogAtom
      open={open}
      onOpenChange={next => {
        if (!next) {
          requestClose();
        }
      }}
      disablePointerDismissal>
      <AppDialogAtom.Content
        title={isEdit ? t('traitEditTitle') : t('traitCreateTitle')}
        closeDisabled={isSaving}>
        <AppDialogAtom.Body>
          <form
            id={formId}
            className={styles.form}
            onSubmit={handleSubmit}
            noValidate>
            <InputAtom
              label={t('fieldName')}
              value={name}
              disabled={isSaving}
              autoComplete='off'
              onChange={e => setName(e.target.value)}
              error={
                touched && !isNameValid
                  ? t('validationNameRequired')
                  : undefined
              }
            />
            <SelectAtom
              label={t('fieldCategory')}
              value={category}
              disabled={isSaving}
              onChange={e => {
                if (isTraitCategory(e.target.value)) {
                  setCategory(e.target.value);
                }
              }}
              options={TRAIT_CATEGORIES.map(value => ({
                value,
                label: t(TRAIT_CATEGORY_LABEL_KEY[value]),
              }))}
            />
          </form>
          {errorMessage !== null && (
            <p className={styles.formError} role='alert'>
              {errorMessage}
            </p>
          )}
        </AppDialogAtom.Body>
        <AppDialogAtom.Actions>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={requestClose}
            disabled={isSaving}>
            {t('cancel')}
          </ButtonAtom>
          <ButtonAtom
            type='submit'
            form={formId}
            variant='primary'
            size='md'
            loading={isSaving}>
            {isEdit ? t('save') : t('addButton')}
          </ButtonAtom>
        </AppDialogAtom.Actions>
      </AppDialogAtom.Content>
    </AppDialogAtom>
  );
}
