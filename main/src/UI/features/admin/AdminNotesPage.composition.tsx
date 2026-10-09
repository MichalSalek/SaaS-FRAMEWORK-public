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

  // DECISION (nie usuwaj tego komentarza):
  // Wersja "main" = najświeższa (created_at desc, tie-break id desc) — zgodnie z
  // backendem (getNotes_IO: output[0] po tym samym orderBy; setMainNote re-stampuje
  // created_at=now). Badge 'main' derywujemy PO TOŻSAMOŚCI (activeNote.id ===
  // mostRecentId), NIE po równości treści editContent===currentMainNotes (poprzedni
  // bug: świecił dla KAŻDEJ wersji, bo editContent zawsze ładowało currentMainNotes;
  // dodatkowo dwie wersje o tej samej treści dawałyby false-positive).
  const newestNote = useMemo<AdminNoteVersion | null>(
    () => (notes ? (sortNotesNewestFirst(notes)[0] ?? null) : null),
    [notes]
  );
  const mostRecentId = newestNote?.id ?? null;

  const isMainVersion =
    !isNewNote && activeNote !== null && activeNote.id === mostRecentId;

  // Per-version content: lista `notes` jest metadata-only, treść wybranej wersji
  // pobieramy osobnym zapytaniem (GET_NOTES?id=…). Bez wybranej wersji / w trybie
  // nowej notatki nie fetchujemy.
  const selectedVersionId = !isNewNote && activeNote ? activeNote.id : null;
  const { versionContent, isFetchingContent, isContentError, refetchContent } =
    useAdminNoteVersionContent(selectedVersionId);

  // Id wersji, której treść wgraliśmy już do edytora — chroni edycje usera
  // przed nadpisaniem przy refetchu (wgrywamy TYLKO gdy zmienia się wybór
  // wersji). Stan, nie ref: od niego zależy, czy edytor pokazuje treść, czy
  // ładowanie (resolveNoteEditorState).
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

  // Po zapisie NOWEJ wersji nie przełączaj się na „najnowszą" z jeszcze
  // nieodświeżonej listy — to była poprzednia wersja, a jej treść nadpisywała
  // dopiero co zapisany tekst w edytorze. Czekamy, aż lista przyniesie id inne
  // niż znane w chwili zapisu, i wtedy wybieramy tę wersję, oznaczając jej treść
  // jako już wgraną (edytor trzyma dokładnie to, co poszło na serwer).
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
    // Edytor jest edytowalny w trakcie zapisu: gdy treść odjechała od tej
    // wysłanej, zostajemy w trybie draftu (przełączenie oznaczyłoby cudzą
    // treść jako „wgraną wersję A", a „ustaw jako główną" działałoby na A).
    if (editContent !== awaiting.sentContent) {
      return;
    }
    setLoadedVersionId(newest.id);
    setActiveNote(newest);
    setIsNewNote(false);
  }, [mostRecentId, notes, editContent]);

  // Wgraj treść WYBRANEJ wersji do edytora — raz na zmianę wyboru (guard ref).
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
        // Ręczny wybór unieważnia oczekiwanie na „nową wersję z listy" — inaczej
        // późniejszy refetch z nowszym id przeskoczyłby selekcję za plecami admina.
        awaitNewestAfterRef.current = undefined;
        setIsNewNote(false);
        setActiveNote(note);
        // editContent wypełni efekt per-version content, gdy treść wersji się rozstrzygnie.
        revealEditor();
      }
    );
  }

  function handleAddNote() {
    // Ponowny klik „Dodaj notatkę" w trybie nowej notatki czyścił pisany tekst.
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
          // Tryb „nowa notatka" zostaje do czasu, aż lista odświeży się
          // o zapisaną wersję (efekt wyżej) — patrz komentarz przy efekcie.
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
