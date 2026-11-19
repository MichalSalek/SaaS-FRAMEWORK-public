// UI/features/admin/AdminNotesPage.composition.tsx
// Admin Notes: the editor of one version (main column) and the list of all
// versions (aside); on a phone the editor leads and the list follows.

import { useState, useEffect, useMemo, useRef } from 'react';
import { useTranslations } from 'next-intl';
import { PlusIcon } from '@phosphor-icons/react';
import { AdminPageLayoutComposition } from '../../layouts/AdminPageLayout.composition';
import { pushNewSnackbar } from '../../../application/app-snackbar/appSnackbar.possibilities.api';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { PageColumnsMolecule } from '../../components/PageColumns/PageColumns.molecule';
import {
  useAdminNotes,
  useAdminNoteVersionContent,
} from './hooks/useAdminNotes';
import { useSaveNote } from './hooks/useSaveNote';
import { useSetMainNote } from './hooks/useSetMainNote';
import { useRevealEditor } from './hooks/useRevealEditor';
import { useLeaveGuard } from '../../shared/hooks/useLeaveGuard';
import { confirmDiscardIfDirty } from '../../../application/routing/leave-guard';
import {
  resolveNoteEditorState,
  sortNotesNewestFirst,
} from './AdminNotesPage.helpers';
import type { AdminNoteVersion } from './hooks/useAdminNotes';
import {
  NotesListPanelOrganism,
  EditorPanelOrganism,
} from './AdminNotesPage.parts.organism';
import styles from './AdminNotesPage.module.css';

export function AdminNotesPageComposition() {
  const t = useTranslations('admin.notes');
  const { notes, isLoading, isFetching, isError, refetch } = useAdminNotes();
  const saveMutation = useSaveNote();
  const setMainMutation = useSetMainNote();

  const [activeNote, setActiveNote] = useState<AdminNoteVersion | null>(null);
  const [editContent, setEditContent] = useState('');
  const [isNewNote, setIsNewNote] = useState(false);

  // DECISION: the "main" version is the newest one (created_at desc, tie-break id desc), matching
  // the backend (getNotes_IO takes output[0] by the same orderBy; setMainNote re-stamps
  // created_at). The "main" badge is derived by IDENTITY (activeNote.id === mostRecentId), never by
  // content equality: that lit up for every version, and two versions with the same text would be
  // false positives.
  const newestNote = useMemo<AdminNoteVersion | null>(
    () => (notes ? (sortNotesNewestFirst(notes)[0] ?? null) : null),
    [notes]
  );
  const mostRecentId = newestNote?.id ?? null;

  const isMainVersion =
    !isNewNote && activeNote !== null && activeNote.id === mostRecentId;

  // Per-version content: the `notes` list is metadata-only, the selected version's content is
  // fetched by a separate query (GET_NOTES?id=…). With no selected version / in new-note mode we do
  // not fetch.
  const selectedVersionId = !isNewNote && activeNote ? activeNote.id : null;
  const { versionContent, isFetchingContent, isContentError, refetchContent } =
    useAdminNoteVersionContent(selectedVersionId);

  // Id of the version whose content we already loaded into the editor: protects the user's edits
  // from being overwritten on refetch (we load ONLY when the selection changes). State, not a ref:
  // it decides whether the editor shows content or loading (resolveNoteEditorState).
  const [loadedVersionId, setLoadedVersionId] = useState<string | null>(null);

  const { contentState, isDirty } = resolveNoteEditorState({
    isNewNote,
    selectedVersionId,
    loadedVersionId,
    versionContent,
    versionContentFailed: isContentError,
    editContent,
  });
  useLeaveGuard({ when: isDirty, message: t('discardDraftConfirm') });

  // First read: open the newest version (its content loads through the
  // per-version effect below). No versions at all: the editor opens as a new
  // note, so the page shows one thing to do instead of two empty states.
  useEffect(() => {
    if (notes === null || activeNote !== null || isNewNote) {
      return;
    }
    if (newestNote !== null) {
      setActiveNote(newestNote);
    } else {
      setIsNewNote(true);
    }
  }, [notes, newestNote, activeNote, isNewNote]);

  const { anchorRef: editorAnchorRef, reveal: revealEditor } =
    useRevealEditor();

  // After saving a NEW version do not switch to the "newest" one from a not-yet-refreshed list:
  // that is the previous version, and its content would overwrite the just-saved text in the editor.
  // Wait until the list brings an id different from those known at save time, then select that
  // version and mark its content as loaded (the editor holds exactly what went to the server).
  const awaitNewestAfterRef = useRef<
    { previousNewestId: string | null; sentContent: string } | undefined
  >(undefined);
  useEffect(() => {
    const awaiting = awaitNewestAfterRef.current;
    if (awaiting === undefined) {
      return;
    }
    if (mostRecentId === null || mostRecentId === awaiting.previousNewestId) {
      return;
    }
    const newest = notes?.find(n => n.id === mostRecentId);
    if (newest === undefined) {
      return;
    }
    awaitNewestAfterRef.current = undefined;
    // The editor stays editable while saving: when the content drifted from the one sent, we stay in
    // draft mode (switching would mark someone else's content as the „loaded version A", and „set as
    // main" would act on A).
    if (editContent !== awaiting.sentContent) {
      return;
    }
    setLoadedVersionId(newest.id);
    setActiveNote(newest);
    setIsNewNote(false);
  }, [mostRecentId, notes, editContent]);

  // Load the content of the SELECTED version into the editor, once per selection change (ref guard).
  useEffect(() => {
    if (isNewNote || selectedVersionId === null || versionContent === null) {
      return;
    }
    if (loadedVersionId === selectedVersionId) {
      return;
    }
    setLoadedVersionId(selectedVersionId);
    setEditContent(versionContent);
  }, [isNewNote, selectedVersionId, versionContent, loadedVersionId]);

  function handleSelect(note: AdminNoteVersion) {
    if (!isNewNote && activeNote?.id === note.id) {
      return;
    }
    void confirmDiscardIfDirty(isDirty, t('discardDraftConfirm')).then(
      discard => {
        if (!discard) {
          return;
        }
        // A manual pick invalidates the wait for a "new version from the list"; otherwise a later refetch
        // with a newer id would jump the selection behind the admin's back.
        awaitNewestAfterRef.current = undefined;
        setIsNewNote(false);
        setActiveNote(note);
        // editContent fills the per-version content effect once the version's content resolves.
        revealEditor();
      }
    );
  }

  function handleAddNote() {
    // Clicking „Dodaj notatkę" again in new-note mode used to clear the typed text.
    if (isNewNote) {
      return;
    }
    void confirmDiscardIfDirty(isDirty, t('discardDraftConfirm')).then(
      discard => {
        if (!discard) {
          return;
        }
        awaitNewestAfterRef.current = undefined;
        setIsNewNote(true);
        setActiveNote(null);
        setEditContent('');
        setLoadedVersionId(null);
        revealEditor();
      }
    );
  }

  function handleSave() {
    if (editContent.trim().length === 0 || contentState !== 'ready') {
      return;
    }
    saveMutation.mutate(
      { notes: editContent },
      {
        onSuccess: () => {
          pushNewSnackbar(t('saveSuccess'), 'success');
          // "New note" mode stays until the list refreshes with the saved version (effect above), see the
          // comment at that effect.
          awaitNewestAfterRef.current = {
            previousNewestId: mostRecentId,
            sentContent: editContent,
          };
        },
        onError: () => {
          pushNewSnackbar(t('saveError'), 'error');
        },
      }
    );
  }

  function handleSetMain() {
    if (!activeNote || contentState !== 'ready') {
      return;
    }
    setMainMutation.mutate(
      { id: activeNote.id },
      {
        onSuccess: () => {
          pushNewSnackbar(t('setMainSuccess'), 'success');
        },
        onError: () => {
          pushNewSnackbar(t('setMainError'), 'error');
        },
      }
    );
  }

  // Never read (first load failed): one error instead of the two panels.
  const loadFailed = isError && !isLoading && notes === null;
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
      title={t('title')}
      subtitle={t('heroSubtitle')}
      actions={
        <ButtonAtom
          size='sm'
          variant='outlined'
          icon={<PlusIcon size={14} weight='bold' />}
          onClick={handleAddNote}
          disabled={isNewNote}>
          {t('addNote')}
        </ButtonAtom>
      }>
      {loadFailed ? (
        <ErrorStateMolecule {...loadError} />
      ) : (
        <div className={styles.page}>
          {/* Refresh after a save failed: the version list below is the last
              good read, and the draft in the editor is untouched. */}
          {isError && !isLoading && (
            <ErrorStateMolecule size='inline' {...loadError} />
          )}
          <PageColumnsMolecule
            asideSize='wide'
            main={
              <div ref={editorAnchorRef} className={styles.editorAnchor}>
                <EditorPanelOrganism
                  activeNote={activeNote}
                  isNewMode={isNewNote}
                  editContent={editContent}
                  isMainVersion={isMainVersion}
                  contentState={contentState}
                  onRetryContent={() => void refetchContent()}
                  isRetryingContent={isFetchingContent}
                  onContentChange={setEditContent}
                  onSave={handleSave}
                  onSetMain={handleSetMain}
                  isSaving={saveMutation.isPending}
                  isSettingMain={setMainMutation.isPending}
                  t={t}
                />
              </div>
            }
            aside={
              <NotesListPanelOrganism
                notes={notes ?? []}
                isLoading={isLoading}
                activeId={isNewNote ? null : (activeNote?.id ?? null)}
                mainId={mostRecentId}
                onSelect={handleSelect}
                t={t}
              />
            }
          />
        </div>
      )}
    </AdminPageLayoutComposition>
  );
}
