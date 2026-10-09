import { describe, it, expect } from 'vitest';
import {
  countWords,
  resolveNoteEditorState,
  sortNotesNewestFirst,
  type NoteEditorInput,
} from './AdminNotesPage.helpers';

const base: NoteEditorInput = {
  isNewNote: false,
  selectedVersionId: 'v1',
  loadedVersionId: 'v1',
  versionContent: 'hello',
  versionContentFailed: false,
  editContent: 'hello',
};

describe('resolveNoteEditorState', () => {
  it('is ready and clean when the editor holds the loaded version verbatim', () => {
    expect(resolveNoteEditorState(base)).toEqual({
      contentState: 'ready',
      isDirty: false,
    });
  });

  it('is dirty once the text departs from the loaded version', () => {
    expect(
      resolveNoteEditorState({ ...base, editContent: 'hello!' }).isDirty
    ).toBe(true);
  });

  it('is loading while a newly picked version has not been loaded yet', () => {
    expect(
      resolveNoteEditorState({
        ...base,
        selectedVersionId: 'v2',
        versionContent: null,
      })
    ).toEqual({ contentState: 'loading', isDirty: false });
  });

  it('keeps loading (not ready) when the picked version content arrived but was not applied', () => {
    // The effect applies it on the next commit; until then the editor text is
    // still the previous version's.
    expect(
      resolveNoteEditorState({
        ...base,
        selectedVersionId: 'v2',
        versionContent: 'other',
      }).contentState
    ).toBe('loading');
  });

  it('is an error when the picked version failed to load', () => {
    expect(
      resolveNoteEditorState({
        ...base,
        selectedVersionId: 'v2',
        versionContent: null,
        versionContentFailed: true,
      }).contentState
    ).toBe('error');
  });

  it('treats a failed background refetch with content in cache as loading, not error', () => {
    expect(
      resolveNoteEditorState({
        ...base,
        selectedVersionId: 'v2',
        versionContent: 'cached',
        versionContentFailed: true,
      }).contentState
    ).toBe('loading');
  });

  it('new note: dirty only with non-blank text', () => {
    const fresh = { ...base, isNewNote: true, selectedVersionId: null };
    expect(resolveNoteEditorState({ ...fresh, editContent: '  ' })).toEqual({
      contentState: 'ready',
      isDirty: false,
    });
    expect(
      resolveNoteEditorState({ ...fresh, editContent: 'draft' }).isDirty
    ).toBe(true);
  });

  it('is not dirty when the loaded version content is not re-read yet', () => {
    expect(
      resolveNoteEditorState({
        ...base,
        versionContent: null,
        editContent: 'just saved',
      })
    ).toEqual({ contentState: 'ready', isDirty: false });
  });
});

describe('sortNotesNewestFirst', () => {
  it('orders by created_at descending and breaks ties by id descending', () => {
    const notes = [
      { id: 'a', created_at: '2026-10-01T10:00:00.000Z' },
      { id: 'c', created_at: '2026-10-02T10:00:00.000Z' },
      { id: 'b', created_at: '2026-10-02T10:00:00.000Z' },
    ];
    expect(sortNotesNewestFirst(notes).map(note => note.id)).toEqual([
      'c',
      'b',
      'a',
    ]);
    // The input is not mutated.
    expect(notes[0]?.id).toBe('a');
  });
});

describe('countWords', () => {
  it('counts whitespace-separated words and ignores the edges', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
    expect(countWords(' jedna  druga\ntrzecia ')).toBe(3);
  });
});
