// admin/components/PolicyEditor.organism.tsx
// The editor of one policy: title, content and the three things that can be
// done with it. Actions a new draft cannot take yet are visible and disabled.

import { useId } from 'react';
import type { FormEvent } from 'react';
import { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../../components/Button/Button.atom';
import { InputAtom } from '../../../components/Input/Input.atom';
import { SkeletonAtom } from '../../../components/Skeleton/Skeleton.atom';
import { AdminPanelMolecule } from './AdminPanel.molecule';
import { estimateEditorRows } from './editor-rows.helpers';
import type { PolicyEditorState } from './policy-editor.utils';
import styles from '../AdminPoliciesPage.module.css';

interface PolicyEditorProps {
  editor: PolicyEditorState;
  isLoading: boolean;
  isMain: boolean;
  isSaving: boolean;
  isDeleting: boolean;
  isSettingMain: boolean;
  savedFlash: boolean;
  onChange: (partial: Partial<PolicyEditorState>) => void;
  onSave: () => void;
  onDeleteRequest: () => void;
  onSetMain: () => void;
}

export function PolicyEditorOrganism({
  editor,
  isLoading,
  isMain,
  isSaving,
  isDeleting,
  isSettingMain,
  savedFlash,
  onChange,
  onSave,
  onDeleteRequest,
  onSetMain,
}: PolicyEditorProps) {
  const t = useTranslations('admin.policies');
  const formId = useId();
  const isNew = editor.id === undefined;

  if (isLoading) {
    return (
      <AdminPanelMolecule
        title={<SkeletonAtom variant='text' width={180} height={22} />}>
        <div className={styles.form} aria-busy='true'>
          <SkeletonAtom variant='rect' width='100%' height={48} />
          <SkeletonAtom variant='rect' width='100%' height={180} />
        </div>
      </AdminPanelMolecule>
    );
  }

  const handleSubmit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    onSave();
  };

  return (
    <AdminPanelMolecule
      title={isNew ? t('newPolicy') : t('editPolicy')}
      // Plain text, like the count in the list panel's title row: a pill here
      // made this row taller, and the two panel titles stood on two lines.
      {...(isMain && { aside: t('main') })}
      footer={
        <>
          <div className={styles.actions}>
            <ButtonAtom
              type='submit'
              form={formId}
              variant='primary'
              size='md'
              loading={isSaving}
              disabled={!editor.title.trim()}>
              {t('save')}
            </ButtonAtom>
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={onSetMain}
              loading={isSettingMain}
              disabled={isNew || isMain}>
              {t('setMain')}
            </ButtonAtom>
            <ButtonAtom
              variant='outlined'
              size='md'
              onClick={onDeleteRequest}
              disabled={isNew || isDeleting}>
              {t('delete')}
            </ButtonAtom>
          </div>
          {/* Always in the row, so the confirmation moves nothing. */}
          <span className={styles.saved} role='status'>
            {savedFlash ? t('saved') : ''}
          </span>
        </>
      }>
      <form
        id={formId}
        className={styles.form}
        onSubmit={handleSubmit}
        noValidate>
        <InputAtom
          label={t('fieldTitle')}
          value={editor.title}
          onChange={e => onChange({ title: e.target.value })}
        />
        <InputAtom
          multiline
          label={t('fieldContent')}
          value={editor.content}
          rows={estimateEditorRows(editor.content, 6, 18)}
          onChange={e => onChange({ content: e.target.value })}
        />
      </form>
    </AdminPanelMolecule>
  );
}
