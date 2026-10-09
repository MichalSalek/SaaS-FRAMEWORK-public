// UI/features/admin/AdminPoliciesPage.composition.tsx
// Admin Policies: the editor of one policy (main column) and the list of all
// of them (aside); on a phone the editor leads and the list follows.

import { useState, useEffect, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PlusIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { useAdminPolicies } from './hooks/useAdminPolicies';
import { useSavePolicy } from './hooks/useSavePolicy';
import { useDeletePolicy } from './hooks/useDeletePolicy';
import { useSetMainPolicy } from './hooks/useSetMainPolicy';
import type { AdminPolicy } from './hooks/useAdminPolicies';
import { PoliciesListOrganism } from './components/PoliciesList.organism';
import { PolicyEditorOrganism } from './components/PolicyEditor.organism';
import { AdminConfirmDeleteDialogMolecule } from './components/AdminConfirmDeleteDialog.molecule';
import { isPolicyDraftDirty } from './components/policy-editor.utils';
import type { PolicyEditorState } from './components/policy-editor.utils';
import { useRevealEditor } from './hooks/useRevealEditor';
import { useLeaveGuard } from '../../shared/hooks/useLeaveGuard';
import { confirmDiscardIfDirty } from '../../../application/routing/leave-guard';
import styles from './AdminPoliciesPage.module.css';

/* ─── Constants ─── */

const EMPTY_EDITOR: PolicyEditorState = {
  id: undefined,
  title: '',
  content: '',
};

/* ─── Main feature component ─── */

export function AdminPoliciesPageComposition() {
  const t = useTranslations('admin.policies');
  const { policies, isLoading, isFetching, isError, refetch } =
    useAdminPolicies();
  const savePolicy = useSavePolicy();
  const deletePolicy = useDeletePolicy();
  const setMainPolicy = useSetMainPolicy();

  const [editor, setEditor] = useState<PolicyEditorState>(EMPTY_EDITOR);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const { anchorRef: editorAnchorRef, reveal: revealEditor } =
    useRevealEditor();
  const [savedFlash, setSavedFlash] = useState(false);

  // Timer gaszący flash „zapisano" z cleanupem (unmount w trakcie 2s =
  // setState na odmontowanym komponencie) — wzorzec jak w
  // StylistProfilePage.composition.
  useEffect(() => {
    if (!savedFlash) {
      return;
    }
    const timer = window.setTimeout(() => setSavedFlash(false), 2000);
    return () => window.clearTimeout(timer);
  }, [savedFlash]);

  /* Select the first policy ONCE, on first load. The previous „pristine editor"
     guard re-ran after „Dodaj politykę" (EMPTY_EDITOR is pristine too) and
     snapped the editor straight back to the first policy, so a second policy
     could never be created. */
  const autoSelectedRef = useRef(false);
  useEffect(() => {
    if (autoSelectedRef.current || !policies || policies.length === 0) {
      return;
    }
    autoSelectedRef.current = true;
    const first = policies[0];
    if (first !== undefined) {
      setEditor({ id: first.id, title: first.title, content: first.content });
    }
  }, [policies]);

  const savedPolicy = policies?.find(p => p.id === editor.id) ?? null;
  const isDirty = isPolicyDraftDirty(editor, savedPolicy);
  useLeaveGuard({ when: isDirty, message: t('discardDraftConfirm') });

  // Picking another policy (or „Dodaj") replaced the editor and silently
  // dropped an unsaved draft.
  const handleSelect = (policy: AdminPolicy) => {
    if (policy.id === editor.id) {
      return;
    }
    void confirmDiscardIfDirty(isDirty, t('discardDraftConfirm')).then(
      discard => {
        if (discard) {
          setSavedFlash(false);
          setEditor({
            id: policy.id,
            title: policy.title,
            content: policy.content,
          });
          revealEditor();
        }
      }
    );
  };

  const handleAdd = () => {
    void confirmDiscardIfDirty(isDirty, t('discardDraftConfirm')).then(
      discard => {
        if (discard) {
          setSavedFlash(false);
          setEditor(EMPTY_EDITOR);
          revealEditor();
        }
      }
    );
  };

  const handleEditorChange = (partial: Partial<PolicyEditorState>) => {
    setSavedFlash(false);
    setEditor(prev => ({ ...prev, ...partial }));
  };

  const handleSave = () => {
    if (!editor.title.trim() || savePolicy.isPending) {
      return;
    }
    const sent = {
      ...(editor.id !== undefined ? { id: editor.id } : {}),
      title: editor.title.trim(),
      content: editor.content,
    };
    savePolicy.mutate(sent, {
      onSuccess: response => {
        // A response confirms only the submitted draft, not later edits or
        // another policy selected while the request was pending.
        const current = editorRef.current;
        const matchesSubmittedDraft =
          current.id === sent.id &&
          current.title.trim() === sent.title &&
          current.content === sent.content;
        // ID nowej polityki przypinamy TYLKO do tego samego draftu — jeśli admin
        // w trakcie zapisu wybrał inną politykę, `prev` to już ona i dostałaby
        // cudze id (kolejny zapis nadpisywałby A treścią B).
        if (sent.id === undefined) {
          setEditor(prev =>
            prev.id === undefined &&
            prev.title.trim() === sent.title &&
            prev.content === sent.content
              ? { ...prev, id: response.policy_id }
              : prev
          );
        }
        setSavedFlash(matchesSubmittedDraft);
      },
      onError: () => {
        pushNewSnackbar(t('saveError'), 'error');
      },
    });
  };

  const handleDeleteConfirm = () => {
    if (!editor.id) {
      return;
    }
    deletePolicy.mutate(
      { id: editor.id },
      {
        onSuccess: () => {
          setDeleteDialogOpen(false);
          setEditor(EMPTY_EDITOR);
          pushNewSnackbar(t('deleteSuccess'));
        },
        onError: () => {
          setDeleteDialogOpen(false);
          pushNewSnackbar(t('deleteError'), 'error');
        },
      }
    );
  };

  const handleSetMain = () => {
    if (!editor.id) {
      return;
    }
    setMainPolicy.mutate(
      { id: editor.id },
      {
        onSuccess: () => {
          pushNewSnackbar(t('setMainSuccess'));
        },
        onError: () => {
          pushNewSnackbar(t('setMainError'), 'error');
        },
      }
    );
  };

  const isMain = savedPolicy?.is_main ?? false;
  // Never read (first load failed): one error instead of the two panels.
  const loadFailed = isError && !isLoading && policies === null;
  const loadError = {
    message: t('loadError'),
    retryLabel: t('retry'),
    onRetry: () => void refetch(),
    isRetrying: isFetching,
  };

  return (
    <AdminPageLayoutComposition
      documentTitle={t('pageTitle')}
      eyebrow={t('heroEyebrow')}
      title={t('pageTitle')}
      subtitle={t('heroSubtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='outlined'
          icon={<PlusIcon size={14} weight='bold' />}
          onClick={handleAdd}
          disabled={editor.id === undefined && !isDirty}>
          {t('addPolicy')}
        </ButtonAtom>
      }>
      {loadFailed ? (
        <ErrorStateMolecule {...loadError} />
      ) : (
        <div className={styles.page}>
          {/* A failed refresh after a save keeps the list and the draft. */}
          {isError && !isLoading && (
            <ErrorStateMolecule size='inline' {...loadError} />
          )}
          <PageColumnsMolecule
            asideSize='wide'
            main={
              <div ref={editorAnchorRef} className={styles.editorAnchor}>
                <PolicyEditorOrganism
                  editor={editor}
                  isLoading={isLoading}
                  isMain={isMain}
                  isSaving={savePolicy.isPending}
                  isDeleting={deletePolicy.isPending}
                  isSettingMain={setMainPolicy.isPending}
                  savedFlash={savedFlash}
                  onChange={handleEditorChange}
                  onSave={handleSave}
                  onDeleteRequest={() => setDeleteDialogOpen(true)}
                  onSetMain={handleSetMain}
                />
              </div>
            }
            aside={
              <PoliciesListOrganism
                policies={policies ?? []}
                state={
                  isLoading
                    ? 'loading'
                    : policies === null || policies.length === 0
                      ? 'empty'
                      : 'ready'
                }
                error={loadError}
                selectedId={editor.id}
                onSelect={handleSelect}
              />
            }
          />
        </div>
      )}

      <AdminConfirmDeleteDialogMolecule
        open={deleteDialogOpen}
        title={t('deleteTitle')}
        message={t('deleteMessage', { title: editor.title })}
        confirmLabel={t('delete')}
        cancelLabel={t('cancel')}
        isDeleting={deletePolicy.isPending}
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteDialogOpen(false)}
      />
    </AdminPageLayoutComposition>
  );
}
