// UI/features/admin/AdminNotesPage.parts.organism.tsx
// The two panels of the notes page: the editor of one version and the list of
// all versions (master and detail). 'Main' is identity-based, via the
// isMainVersion / mainId props (DECISION in AdminNotesPage.composition).

import { useEffect, useState } from 'react';
import type { useTranslations } from 'next-intl';
import { ButtonAtom } from '../../components/Button/Button.atom';
import { DataTableOrganism } from '../../components/DataTable/DataTable.organism';
import type { DataTableColumn } from '../../components/DataTable/DataTable.organism';
import { ErrorStateMolecule } from '../../components/ErrorState/ErrorState.molecule';
import { InputAtom } from '../../components/Input/Input.atom';
import { PaginationMolecule } from '../../components/Pagination/Pagination.molecule';
import { SkeletonAtom } from '../../components/Skeleton/Skeleton.atom';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { formatDateTimePL } from '../../../application/date/date.utils';
import type { AdminNoteVersion } from './hooks/useAdminNotes';
import { AdminPanelMolecule } from './components/AdminPanel.molecule';
import { estimateEditorRows } from './components/editor-rows.helpers';
import {
  NOTES_PAGE_SIZE,
  countWords,
  sortNotesNewestFirst,
} from './AdminNotesPage.helpers';
import type { NoteContentState } from './AdminNotesPage.helpers';
import styles from './AdminNotesPage.module.css';

type TNotes = ReturnType<typeof useTranslations<'admin.notes'>>;

const MAIN_COLOR = 'var(--color-success)';

interface NotesListPanelProps {
  notes: readonly AdminNoteVersion[];
  isLoading: boolean;
  activeId: string | null;
  /** The version that is the main note right now (the newest one). */
  mainId: string | null;
  onSelect: (note: AdminNoteVersion) => void;
  t: TNotes;
}

export function NotesListPanelOrganism({
  notes,
  isLoading,
  activeId,
  mainId,
  onSelect,
  t,
}: NotesListPanelProps) {
  const sorted = sortNotesNewestFirst(notes);
  const pageCount = Math.max(1, Math.ceil(sorted.length / NOTES_PAGE_SIZE));
  const [page, setPage] = useState(1);
  const current = Math.min(page, pageCount);

  // The version in the editor is always on the visible page (a save adds a
  // version on page one).
  const activeIndex =
    activeId === null ? -1 : sorted.findIndex(note => note.id === activeId);
  const activePage =
    activeIndex === -1 ? null : Math.floor(activeIndex / NOTES_PAGE_SIZE) + 1;
  useEffect(() => {
    if (activePage !== null) {
      setPage(activePage);
    }
  }, [activePage]);

  const columns: DataTableColumn<AdminNoteVersion>[] = [
    {
      id: 'created',
      header: t('columnCreated'),
      priority: 'primary',
      cell: note => (
        <span className={styles.nowrap}>
          {formatDateTimePL(note.created_at)}
        </span>
      ),
    },
    {
      id: 'main',
      header: t('columnStatus'),
      priority: 'meta',
      cell: note =>
        note.id === mainId ? (
          <StatusPillAtom color={MAIN_COLOR} label={t('mainBadge')} />
        ) : null,
    },
    {
      id: 'length',
      header: t('columnLength'),
      priority: 'meta',
      cell: note => (
        <span className={styles.nowrap}>
          {t('chars', { count: note.length })}
        </span>
      ),
    },
  ];

  return (
    <AdminPanelMolecule
      title={t('versionsTitle')}
      {...(!isLoading && notes.length > 0 && { aside: String(notes.length) })}>
      <DataTableOrganism
        columns={columns}
        rows={sorted.slice(
          (current - 1) * NOTES_PAGE_SIZE,
          current * NOTES_PAGE_SIZE
        )}
        rowKey={note => note.id}
        caption={t('versionsTitle')}
        onRowClick={onSelect}
        rowLabel={note =>
          t('selectRowAriaLabel', { date: formatDateTimePL(note.created_at) })
        }
        selectedKey={activeId}
        state={isLoading ? 'loading' : notes.length === 0 ? 'empty' : 'ready'}
        empty={<p className={styles.listEmpty}>{t('noNotes')}</p>}
        skeletonRows={6}
        density='compact'
        surface='flush'
        footer={
          pageCount > 1 ? (
            <PaginationMolecule
              mode='pages'
              ariaLabel={t('paginationAriaLabel')}
              prevLabel={t('paginationPrev')}
              nextLabel={t('paginationNext')}
              summary={t('paginationSummary', { page: current, pageCount })}
              page={current}
              pageCount={pageCount}
              onPageChange={setPage}
              pageLabel={n => t('paginationPage', { page: n })}
            />
          ) : undefined
        }
      />
    </AdminPanelMolecule>
  );
}

interface EditorPanelProps {
  activeNote: AdminNoteVersion | null;
  isNewMode: boolean;
  editContent: string;
  /**
   * True when the selected version IS the current "main" (most-recent) note.
   * Identity-based (id match), computed by the parent — NOT content equality
   * (which mislabeled every version as main). See DECISION in the composition.
   */
  isMainVersion: boolean;
  /** Content of the picked version: loaded, still loading, or failed to load. */
  contentState: NoteContentState;
  onRetryContent: () => void;
  /** A retry of the version-content fetch is in flight. */
  isRetryingContent?: boolean;
  onContentChange: (value: string) => void;
  onSave: () => void;
  onSetMain: () => void;
  isSaving: boolean;
  isSettingMain: boolean;
  t: TNotes;
}

export function EditorPanelOrganism({
  activeNote,
  isNewMode,
  editContent,
  isMainVersion,
  contentState,
  onRetryContent,
  isRetryingContent = false,
  onContentChange,
  onSave,
  onSetMain,
  isSaving,
  isSettingMain,
  t,
}: EditorPanelProps) {
  // Nothing picked yet (the list is still loading or about to pick the
  // newest version): the editor's own shape, no second empty state.
  const isPending = !activeNote && !isNewMode;
  const isMain = !isNewMode && isMainVersion;
  const isReady = !isPending && contentState === 'ready';

  const title = isPending ? (
    <SkeletonAtom variant='text' width={180} height={22} />
  ) : isNewMode || !activeNote ? (
    t('newNote')
  ) : (
    formatDateTimePL(activeNote.created_at)
  );

  return (
    <AdminPanelMolecule
      title={title}
      // Plain text, like the count in the list panel's title row: a pill here
      // made this row taller, and the two panel titles stood on two lines.
      {...(isMain && { aside: t('mainBadge') })}
      footer={
        <div className={styles.actions}>
          <ButtonAtom
            variant='primary'
            size='md'
            onClick={onSave}
            loading={isSaving}
            disabled={!isReady || editContent.trim().length === 0}>
            {t('saveAsNewVersion')}
          </ButtonAtom>
          <ButtonAtom
            variant='outlined'
            size='md'
            onClick={onSetMain}
            loading={isSettingMain}
            disabled={!isReady || isNewMode || isMain}>
            {t('setAsMain')}
          </ButtonAtom>
        </div>
      }>
      {/* Counts describe the text in the editor; while another version loads
          that text is not the one named in the title. The line keeps its
          height, so the field below does not move. */}
      <p className={styles.counts} aria-live='polite'>
        {isReady
          ? `${t('chars', { count: editContent.length })}, ${t('words', { count: countWords(editContent) })}`
          : ''}
      </p>

      {!isPending && contentState === 'error' ? (
        <ErrorStateMolecule
          size='inline'
          message={t('versionLoadError')}
          retryLabel={t('retry')}
          onRetry={onRetryContent}
          isRetrying={isRetryingContent}
        />
      ) : !isReady ? (
        <div aria-busy='true'>
          <SkeletonAtom variant='rect' width='100%' height={160} />
        </div>
      ) : (
        <InputAtom
          multiline
          rows={estimateEditorRows(editContent, 5, 16)}
          value={editContent}
          onChange={e => onContentChange(e.target.value)}
          placeholder={t('editorTextareaPlaceholder')}
          aria-label={t('editorAriaLabel')}
        />
      )}
    </AdminPanelMolecule>
  );
}
