// admin/components/ColorFormDialog.organism.tsx
// Create / edit one polish colour. The same dialog serves both: the admin
// editors open their form in a dialog, so a row never changes height.

import { useEffect, useId, useState } from 'react';
import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { AppDialogAtom } from '../../../primitives/AppDialog.atom';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { useLeaveGuard } from '../../../shared/hooks/useLeaveGuard';
import { confirmDiscardIfDirty } from '../../../../application/routing/leave-guard';
import type { AdminColor } from '../hooks/useAdminColors';
import styles from '../AdminColorsTraitsPage.module.css';

const DEFAULT_HEX = '#ff0000';
const HEX_PATTERN = /^#[0-9a-f]{6}$/i;

export interface ColorFormData {
  name: string;
  hex_code: string;
}

interface ColorFormDialogProps {
  open: boolean;
  /** `null` = a new colour. */
  editing: AdminColor | null;
  isSaving: boolean;
  /** The last save failed: shown next to the buttons until the next try. */
  errorMessage: string | null;
  onSubmit: (data: ColorFormData) => void;
  onCancel: () => void;
}

export function ColorFormDialogOrganism({
  open,
  editing,
  isSaving,
  errorMessage,
  onSubmit,
  onCancel,
}: ColorFormDialogProps) {
  const t = useTranslations('admin.colorsTraits');
  const formId = useId();
  const [name, setName] = useState('');
  const [hex, setHex] = useState(DEFAULT_HEX);
  const [touched, setTouched] = useState(false);
  // Frozen while the dialog is open: the title must not flip to „new” while
  // the dialog of a finished edit is still closing.
  const [isEdit, setIsEdit] = useState(false);

  const initialName = editing?.name ?? '';
  const initialHex = editing?.hex_code ?? DEFAULT_HEX;

  // Reset whenever the dialog (re)opens or its target changes.
  useEffect(() => {
    if (!open) {
      return;
    }
    setName(initialName);
    setHex(initialHex);
    setTouched(false);
    setIsEdit(editing !== null);
  }, [open, editing, initialName, initialHex]);

  const isHexValid = HEX_PATTERN.test(hex);
  const isNameValid = name.trim().length > 0;
  const isDirty = open && (name !== initialName || hex !== initialHex);
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
    if (!isNameValid || !isHexValid || isSaving) {
      return;
    }
    onSubmit({ name: name.trim(), hex_code: hex.toLowerCase() });
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
        title={isEdit ? t('colorEditTitle') : t('colorCreateTitle')}
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
            <div className={styles.colorField}>
              {/* The system colour picker has no shared primitive: it stays a
                  native control, paired with the code field that names it. */}
              <input
                type='color'
                className={styles.colorPicker}
                value={isHexValid ? hex : DEFAULT_HEX}
                disabled={isSaving}
                onChange={e => setHex(e.target.value)}
                aria-label={t('colorPickerAriaLabel')}
              />
              <InputAtom
                label={t('fieldHex')}
                value={hex}
                disabled={isSaving}
                autoComplete='off'
                autoCapitalize='none'
                spellCheck={false}
                maxLength={7}
                onChange={e => setHex(e.target.value.trim())}
                error={touched && !isHexValid ? t('validationHex') : undefined}
              />
            </div>
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
