import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import type { AbstractIntlMessages } from 'next-intl';
import { VISIT_CONFIG } from '@kernel/domain/visit/visit.config';
import plMessages from '../../../locales/pl/common.json';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { CrmNoteSectionOrganism } from './ClientCardPage.crm-note.organism';

const messages = {
  clientCard: {
    ...plMessages.clientCard,
    noteConflict: {
      title: 'Note changed',
      description: 'Compare versions',
      stored: 'Stored note',
      draft: 'Your draft',
      empty: 'Empty',
      loading: 'Loading current note',
      loadError: 'Could not load current note',
      retryLoad: 'Retry loading',
      useStored: 'Use stored note',
      overwrite: 'Replace stored note with my draft',
    },
  },
  buttons: plMessages.buttons,
  components: plMessages.components,
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

  it('retains a system-expanded baseline when editing beyond the manual base cap', () => {
    const baseline = '😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 100);
    const { props } = renderNote({ initialNote: baseline });
    const edited = `X${Array.from(baseline).slice(1).join('')}`;
    fireEvent.change(noteField(), { target: { value: edited } });
    expect(noteField()).toHaveValue(edited);
    fireEvent.blur(noteField());
    expect(props.onSave).toHaveBeenCalledWith(edited, null);
    expect(
      screen.getByText(
        `${VISIT_CONFIG.CRM_NOTE_MAX + 100} / ${VISIT_CONFIG.CRM_NOTE_MAX + 100} znaków`
      )
    ).toBeInTheDocument();
  });

  it('does not allow growing a system-expanded note beyond its persisted baseline', () => {
    const baseline = '😀'.repeat(VISIT_CONFIG.CRM_NOTE_MAX + 100);
    renderNote({ initialNote: baseline });
    fireEvent.change(noteField(), { target: { value: `${baseline}extra` } });
    expect(noteField()).toHaveValue(baseline);
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

  it('preserves a dirty draft when a server refetch reports a deletion', () => {
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
    expect(noteField()).toHaveValue('brudny szkic');
  });
  it('clears the draft after this user confirms and completes deletion', () => {
    const { rerender, props } = renderNote({ initialNote: 'server' });
    fireEvent.change(noteField(), { target: { value: 'draft' } });
    fireEvent.click(screen.getByRole('button', { name: DELETE_LABEL }));
    const dialog = screen.getByRole('dialog', { name: DELETE_TITLE });
    fireEvent.click(within(dialog).getByRole('button', { name: DELETE_LABEL }));
    rerender(<CrmNoteSectionOrganism {...props} isDeleting />);
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
  const FAILED = plMessages.components.outcomeFeedback.saveFailed;
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
    expect(onSave).toHaveBeenCalledWith('nowa wersja', null);
  });

  it('compares the server version and requires an explicit guarded overwrite', async () => {
    const first = '2026-10-24T10:00:00.000Z',
      second = '2026-10-24T11:00:00.000Z';
    const fetchCurrent = vi
      .fn()
      .mockResolvedValue({ note: 'other note', updatedAt: second });
    const onSave = vi.fn();
    const error = Object.assign(new Error('VALIDATION_FAILED'), {
      httpError: {
        event: 'VALIDATION_FAILED',
        data: { field: 'note', message: 'validation.visit.crmNoteChanged' },
      },
    });
    const { rerender, props } = renderNote({
      initialNote: 'baseline',
      updatedAt: first,
      onSave,
      fetchCurrent,
    });
    fireEvent.change(noteField(), { target: { value: 'my draft' } });
    rerender(
      <CrmNoteSectionOrganism {...props} isSaveError saveError={error} />
    );
    await screen.findByText('other note');
    expect(noteField()).toHaveValue('my draft');
    expect(onSave).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole('button', { name: 'Replace stored note with my draft' })
    );
    expect(onSave).toHaveBeenCalledWith('my draft', second, true);
  });
  it('keeps the draft when comparison loading fails and retries the read only', async () => {
    const error = Object.assign(new Error('VALIDATION_FAILED'), {
      httpError: {
        event: 'VALIDATION_FAILED',
        data: { field: 'note', message: 'validation.visit.crmNoteChanged' },
      },
    });
    const fetchCurrent = vi
      .fn()
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValueOnce({ note: 'stored', updatedAt: null });
    const onSave = vi.fn();
    const { rerender, props } = renderNote({
      initialNote: 'original',
      fetchCurrent,
      onSave,
    });
    fireEvent.change(noteField(), { target: { value: 'my draft' } });
    rerender(
      <CrmNoteSectionOrganism {...props} isSaveError saveError={error} />
    );
    await screen.findByText('Could not load current note');
    expect(noteField()).toHaveValue('my draft');
    fireEvent.click(screen.getByRole('button', { name: 'Retry loading' }));
    await screen.findByText('stored');
    expect(onSave).not.toHaveBeenCalled();
    expect(noteField()).toHaveValue('my draft');
  });
  it('adopts an untouched external update without writing the old text', async () => {
    const { rerender, props } = renderNote({
      initialNote: 'old',
      updatedAt: '2026-10-24T10:00:00.000Z',
    });
    rerender(
      <CrmNoteSectionOrganism
        {...props}
        initialNote='new'
        updatedAt='2026-10-24T11:00:00.000Z'
      />
    );
    await waitFor(() => expect(noteField()).toHaveValue('new'));
    fireEvent.blur(noteField());
    expect(props.onSave).not.toHaveBeenCalled();
  });
  it('shows no failure mark when nothing is left unsaved', () => {
    renderNote({ initialNote: 'server', isSaveError: true });
    expect(screen.queryByRole('alert')).toBeNull();
    expect(screen.getByRole('status')).not.toHaveTextContent(FAILED);
  });

  it('keeps the hydrated revision for a dirty draft when an external refetch appends request context', () => {
    const first = '2026-10-24T10:00:00.000Z';
    const { rerender, props } = renderNote({
      initialNote: 'baseline',
      updatedAt: first,
    });
    fireEvent.change(noteField(), { target: { value: 'my unsaved draft' } });
    rerender(
      <CrmNoteSectionOrganism
        {...props}
        initialNote={'baseline\n\nClient request'}
        updatedAt='2026-10-24T11:00:00.000Z'
      />
    );
    expect(noteField()).toHaveValue('my unsaved draft');
    fireEvent.blur(noteField());
    expect(props.onSave).toHaveBeenCalledWith('my unsaved draft', first);
  });

  it('adopts the first loaded note revision and later acknowledged own-save revision', () => {
    const first = '2026-10-24T10:00:00.000Z';
    const second = '2026-10-24T11:00:00.000Z';
    const { rerender, props } = renderNote({ initialNote: undefined });
    rerender(
      <CrmNoteSectionOrganism
        {...props}
        initialNote='loaded'
        updatedAt={first}
      />
    );
    fireEvent.change(noteField(), { target: { value: 'saved draft' } });
    fireEvent.blur(noteField());
    expect(props.onSave).toHaveBeenLastCalledWith('saved draft', first);
    rerender(
      <CrmNoteSectionOrganism
        {...props}
        initialNote='saved draft'
        updatedAt={second}
        savedNote={{ note: 'saved draft', updatedAt: second }}
      />
    );
    fireEvent.change(noteField(), { target: { value: 'next draft' } });
    fireEvent.blur(noteField());
    expect(props.onSave).toHaveBeenLastCalledWith('next draft', second);
  });
});
