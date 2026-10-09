import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, within } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import plMessages from '../../../locales/pl/common.json';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { CrmNoteSectionOrganism } from './ClientCardPage.crm-note.organism';

const messages = {
  clientCard: plMessages.clientCard,
  buttons: plMessages.buttons,
} as unknown as AbstractIntlMessages;

const NOTE_FIELD_NAME = plMessages.clientCard.notePlaceholder;
const DELETE_LABEL = plMessages.clientCard.noteDelete;
const DELETE_TITLE = plMessages.clientCard.noteDeleteTitle;

function renderNote(
  overrides: Partial<Parameters<typeof CrmNoteSectionOrganism>[0]> = {}
) {
  const props = {
    initialNote: null as string | null | undefined,
    updatedAt: null as string | null,
    isLoading: false,
    isError: false,
    onRetry: vi.fn(),
    isSaving: false,
    isDeleting: false,
    isDeleteError: false,
    onSave: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  };
  const view = renderWithProviders(<CrmNoteSectionOrganism {...props} />, {
    messages,
  });
  return { ...view, props };
}

it('blad BEZ wczytanej notatki nie renderuje edytowalnego pustego pola', () => {
  // Regresja: na bledzie kwerendy `initialNote` zostaje undefined, a `isLoading`
  // opada — pole renderowalo sie puste i edytowalne, wiec blur zapisywal pustke
  // NA notatce, ktora po stronie serwera dalej istnieje.
  renderNote({ isError: true, initialNote: undefined });

  expect(screen.queryByRole('textbox', { name: NOTE_FIELD_NAME })).toBeNull();
});

it('blad PO wczytaniu notatki zostawia edytor (nieudane odswiezenie w tle)', () => {
  // Druga strona tej samej reguly: TanStack ustawia status bledu ZACHOWUJAC dane,
  // wiec samo `isError` zabieraloby edytor rowniez wtedy, gdy notatka jest juz
  // wczytana i mozna ja bezpiecznie edytowac.
  renderNote({ isError: true, initialNote: 'Woli krotkie paznokcie' });

  expect(noteField()).toHaveValue('Woli krotkie paznokcie');
});

function noteField() {
  return screen.getByRole('textbox', { name: NOTE_FIELD_NAME });
}

describe('CrmNoteSectionOrganism — code-point counter', () => {
  it('counts emoji as Unicode code points', () => {
    renderNote();
    fireEvent.change(noteField(), { target: { value: '😀😃😄' } });
    expect(
      screen.getByText(`3 / ${VISIT_CONFIG.CRM_NOTE_MAX} znaków`)
    ).toBeInTheDocument();
  });

  it('clamps pasted text to CRM_NOTE_MAX code points', () => {
    renderNote();
    const overflow = `${'😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX)}extra`;
    fireEvent.change(noteField(), { target: { value: overflow } });
    expect(noteField()).toHaveValue('😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX));
    expect(
      screen.getByText(
        `${VISIT_CONFIG.CRM_NOTE_MAX} / ${VISIT_CONFIG.CRM_NOTE_MAX} znaków`
      )
    ).toBeInTheDocument();
  });
});

describe('CrmNoteSectionOrganism — delete note', () => {
  it('hides the delete action when the server note is empty', () => {
    renderNote({ initialNote: '' });
    expect(
      screen.queryByRole('button', { name: DELETE_LABEL })
    ).not.toBeInTheDocument();
  });

  it('shows the delete action only for a non-empty server note and calls onDelete after confirm', () => {
    const onDelete = vi.fn();
    renderNote({ initialNote: 'alergia na akryl', onDelete });

    fireEvent.click(screen.getByRole('button', { name: DELETE_LABEL }));
    expect(onDelete).not.toHaveBeenCalled();

    const dialog = screen.getByRole('dialog', { name: DELETE_TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: DELETE_LABEL }));
    expect(onDelete).toHaveBeenCalledTimes(1);
  });

  it('clears a dirty local draft when the server note is deleted', () => {
    const { rerender, props } = renderNote({ initialNote: 'server' });
    fireEvent.change(noteField(), { target: { value: 'brudny szkic' } });
    expect(noteField()).toHaveValue('brudny szkic');

    rerender(
      <CrmNoteSectionOrganism
        {...props}
        initialNote={null}
        isDeleting={false}
      />
    );
    expect(noteField()).toHaveValue('');
  });
});

describe('CrmNoteSectionOrganism — failed save', () => {
  const FAILED = plMessages.clientCard.noteSaveFailed;
  const RETRY = plMessages.buttons.retry;

  it('keeps the draft and offers a retry that re-sends it', () => {
    const onSave = vi.fn();
    const { rerender, props } = renderNote({ initialNote: 'server', onSave });
    fireEvent.change(noteField(), { target: { value: 'nowa wersja' } });

    // The upsert failed: the server note did not move, the mutation errored.
    rerender(<CrmNoteSectionOrganism {...props} isSaveError />);

    expect(noteField()).toHaveValue('nowa wersja');
    expect(screen.getByRole('alert')).toHaveTextContent(FAILED);
    fireEvent.click(screen.getByRole('button', { name: RETRY }));
    expect(onSave).toHaveBeenCalledWith('nowa wersja');
  });

  it('shows no failure mark when nothing is left unsaved', () => {
    renderNote({ initialNote: 'server', isSaveError: true });
    expect(screen.queryByText(FAILED)).toBeNull();
  });
});
