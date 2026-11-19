import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider, useTranslations } from 'next-intl';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { SessionContainerLifecycleStateValue } from '@kernel/models/db_models.generated.dto';
import messages from '../../../locales/pl/common.json';
import { ClientSessionNoteOrganism } from './ClientSessionNote.organism';

interface SaveCallbacks {
  onSuccess?: () => void;
  onError?: () => void;
}
const mutation = vi.hoisted(() => ({
  isPending: false,
  isSuccess: false,
  mutate: vi.fn<(value: string, callbacks: SaveCallbacks) => void>(),
}));
vi.mock('next/router', () => ({ useRouter: () => ({ locale: 'pl' }) }));
vi.mock('./hooks/useUpdateSessionNote', () => ({
  useUpdateSessionNote: () => mutation,
}));
const session: SessionContainerDetailDTO = {
  id: 'session',
  clientAccountId: 'client',
  clientName: null,
  clientUserId: null,
  stylistAccountId: null,
  name: null,
  lifecycleState: SessionContainerLifecycleStateValue.DRAFT,
  stylistNote: null,
  clientNote: '',
  sharedAt: null,
  expiresAt: null,
  closedAt: null,
  createdAt: '2026-10-01T12:00:00Z',
  updatedAt: '2026-10-01T12:00:00Z',
  photoCount: 0,
  photos: [],
};
function Note({
  saved = '',
  terminal = false,
}: {
  saved?: string;
  terminal?: boolean;
}) {
  const t = useTranslations('pages.sessions');
  return (
    <ClientSessionNoteOrganism
      session={{ ...session, clientNote: saved }}
      isTerminal={terminal}
      t={t}
    />
  );
}
function tree(saved = '', terminal = false) {
  return (
    <NextIntlClientProvider locale='pl' messages={messages}>
      <Note saved={saved} terminal={terminal} />
    </NextIntlClientProvider>
  );
}
function callback(index: number): SaveCallbacks {
  const call = mutation.mutate.mock.calls.at(index);
  if (call === undefined) {
    throw new Error('Expected note save request');
  }
  return call[1];
}
beforeEach(() => {
  mutation.isPending = false;
  mutation.isSuccess = false;
  mutation.mutate.mockReset();
});
describe('client note durable save outcome', () => {
  it('acknowledges saved text then clears acknowledgement when a new draft is typed', () => {
    const view = render(tree());
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Blue nails' } });
    fireEvent.blur(field);
    expect(mutation.mutate).toHaveBeenCalledWith(
      'Blue nails',
      expect.objectContaining({ onSuccess: expect.any(Function) })
    );
    act(() => callback(0).onSuccess?.());
    mutation.isSuccess = true;
    view.rerender(tree('Blue nails'));
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.components.outcomeFeedback.saveDone
    );
    fireEvent.change(field, { target: { value: 'Green nails' } });
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.components.outcomeFeedback.saveDirty
    );
    expect(screen.getByRole('textbox')).toHaveValue('Green nails');
  });
  it('retains a failed draft and retries exactly that draft', () => {
    render(tree());
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'Keep this note' } });
    fireEvent.blur(field);
    act(() => callback(0).onError?.());
    expect(field).toHaveValue('Keep this note');
    expect(screen.getByRole('alert')).toHaveTextContent(
      messages.components.outcomeFeedback.saveFailed
    );
    fireEvent.click(
      screen.getByRole('button', { name: messages.pages.sessions.retryBtn })
    );
    expect(mutation.mutate).toHaveBeenNthCalledWith(
      2,
      'Keep this note',
      expect.any(Object)
    );
  });
  it('queues a newer draft after an older save without acknowledging the unsaved text', () => {
    const view = render(tree());
    const field = screen.getByRole('textbox');
    fireEvent.change(field, { target: { value: 'First' } });
    fireEvent.blur(field);
    mutation.isPending = true;
    view.rerender(tree());
    fireEvent.change(field, { target: { value: 'Latest' } });
    fireEvent.blur(field);
    expect(mutation.mutate).toHaveBeenCalledOnce();
    act(() => callback(0).onSuccess?.());
    expect(mutation.mutate).toHaveBeenNthCalledWith(
      2,
      'Latest',
      expect.any(Object)
    );
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.components.outcomeFeedback.savePending
    );
    act(() => callback(1).onSuccess?.());
    mutation.isPending = false;
    mutation.isSuccess = true;
    view.rerender(tree('Latest'));
    expect(screen.getByRole('status')).toHaveTextContent(
      messages.components.outcomeFeedback.saveDone
    );
  });
  it('renders terminal notes read-only without a save confirmation or retry control', () => {
    render(tree('Existing note', true));
    expect(screen.getByText('Existing note')).toBeVisible();
    expect(screen.queryByRole('textbox')).toBeNull();
    expect(screen.queryByRole('status')).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
    expect(mutation.mutate).not.toHaveBeenCalled();
  });
});
