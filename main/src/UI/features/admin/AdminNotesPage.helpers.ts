// UI/features/admin/AdminNotesPage.helpers.ts
// Pure editor-state resolution for AdminNotesPage (unit-tested).

export type NoteContentState = 'ready' | 'loading' | 'error';

export interface NoteEditorInput {
  isNewNote: boolean;
  /** Version picked in the list (null in „new note" mode or before a pick). */
  selectedVersionId: string | null;
  /** Version whose content was last loaded into the editor. */
  loadedVersionId: string | null;
  /** Server content of the selected version (null until it resolves). */
  versionContent: string | null;
  versionContentFailed: boolean;
  editContent: string;
}

export interface NoteEditorState {
  contentState: NoteContentState;
  /** The editor holds text that is on no server version yet. */
  isDirty: boolean;
}

// DECISION (nie usuwaj tego komentarza): edytor trzyma treść POPRZEDNIEJ wersji,
// dopóki treść wybranej się nie wczyta. Bez stanu 'loading' tytuł i przycisk
// „Ustaw jako główną" mówiły o wersji B nad tekstem wersji A, a błąd pobrania
// zostawiał tak na stałe (zapis tworzył kopię A jako „nową wersję").
export function resolveNoteEditorState(
  input: NoteEditorInput
): NoteEditorState {
  const {
    isNewNote,
    selectedVersionId,
    loadedVersionId,
    versionContent,
    versionContentFailed,
    editContent,
  } = input;

  if (isNewNote) {
    return { contentState: 'ready', isDirty: editContent.trim().length > 0 };
  }
  if (selectedVersionId === null) {
    return { contentState: 'ready', isDirty: false };
  }
  if (loadedVersionId !== selectedVersionId) {
    return {
      contentState:
        versionContentFailed && versionContent === null ? 'error' : 'loading',
      isDirty: false,
    };
  }
  return {
    contentState: 'ready',
    // Content not re-read yet (e.g. the version just saved): nothing to compare.
    isDirty: versionContent !== null && editContent !== versionContent,
  };
}

export const NOTES_PAGE_SIZE = 10;

/** Newest first; equal timestamps fall back to the id, like the backend. */
export function sortNotesNewestFirst<
  T extends { id: string; created_at: string | Date },
>(notes: readonly T[]): T[] {
  return [...notes].sort((a, b) => {
    const delta =
      new Date(b.created_at).getTime() - new Date(a.created_at).getTime();
    return delta !== 0 ? delta : b.id.localeCompare(a.id);
  });
}

export function countWords(text: string): number {
  const trimmed = text.trim();
  return trimmed.length === 0 ? 0 : trimmed.split(/\s+/).length;
}
