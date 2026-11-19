import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { DashboardNoteOrganism } from './DashboardNote.organism';
const save = vi.hoisted(() => vi.fn());
const COPY = { title: 'title', placeholder: 'placeholder', hint: 'hint' };
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./hooks/useDashboardNote', () => ({
  useDashboardNote: () => ({
    note: '',
    isLoading: false,
    loadFailed: false,
    retryLoad: vi.fn(),
    isRetrying: false,
    saveNoteAsync: save,
    isSaving: false,
  }),
}));
afterEach(() => {
  vi.useRealTimers();
  save.mockReset();
});
describe('dashboard note durable outcomes', () => {
  it('does not acknowledge a newer draft when an older queued value succeeds', async () => {
    vi.useFakeTimers();
    let resolve: () => void = () => undefined;
    save
      .mockImplementationOnce(
        () =>
          new Promise<void>(done => {
            resolve = done;
          })
      )
      .mockResolvedValue(undefined);
    render(
      <DashboardNoteOrganism
        accountType={AccountTypeValue.STYLIST}
        copy={COPY}
      />
    );
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'A' } });
    fireEvent.blur(field);
    await act(async () => {});
    fireEvent.change(field, { target: { value: 'B' } });
    await act(async () => resolve());
    expect(screen.getByRole('status').textContent).toBe('saveDirty');
    expect(save).toHaveBeenCalledTimes(1);
    fireEvent.blur(field);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('saveDone');
    fireEvent.change(field, { target: { value: 'C' } });
    expect(screen.getByRole('status').textContent).toBe('saveDirty');
  });
  it('keeps the draft after a failure and retries on blur', async () => {
    save
      .mockRejectedValueOnce(new Error('offline'))
      .mockResolvedValue(undefined);
    render(
      <DashboardNoteOrganism
        accountType={AccountTypeValue.CLIENT}
        copy={COPY}
      />
    );
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Keep me' } });
    fireEvent.blur(field);
    await act(async () => {});
    expect(screen.getByRole('alert').textContent).toBe('saveFailed');
    expect((field as HTMLTextAreaElement).value).toBe('Keep me');
    fireEvent.blur(field);
    await act(async () => {});
    expect(screen.getByRole('status').textContent).toBe('saveDone');
    expect(save).toHaveBeenCalledTimes(2);
  });
});
