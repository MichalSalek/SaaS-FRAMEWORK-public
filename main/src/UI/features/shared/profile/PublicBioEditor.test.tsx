import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { SafeStylistAccountWire } from '@kernel/domain/user/user.contract-schemas';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import {
  getLeavePrompt,
  requestLeave,
  resetLeaveGuardForTests,
  resolveLeavePrompt,
} from '../../../../application/routing/leave-guard';
import { PublicBioEditorOrganism } from './PublicBioEditor.organism';

const mutate = vi.fn();
const sessionState = vi.hoisted(() => ({
  pending: false,
  userId: 'user-a',
  error: null as null | { status: number },
}));
vi.mock('../../../../application/auth/better-auth-client', () => ({
  authClient: {
    useSession: () => ({
      isPending: sessionState.pending,
      error: sessionState.error,
      data: { user: { id: sessionState.userId } },
    }),
  },
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('./hooks/useUpdateStylistProfile', () => ({
  useUpdateStylistProfile: () => ({ mutateAsync: mutate, isPending: false }),
}));
vi.mock('./StylistBioField.molecule', () => ({
  StylistBioFieldMolecule: ({
    value,
    onChange,
    onBlur,
  }: {
    value: string;
    onChange: (value: string) => void;
    onBlur?: () => void;
  }) => (
    <textarea
      aria-label='bio'
      value={value}
      onChange={event => onChange(event.target.value)}
      onBlur={onBlur}
    />
  ),
}));
vi.mock('./ProfileSaveLine.molecule', () => ({
  ProfileSaveLineMolecule: ({
    hasFailure,
    onRetry,
  }: {
    hasFailure: boolean;
    onRetry: () => void;
  }) => (hasFailure ? <button onClick={onRetry}>retry</button> : null),
}));
vi.mock('../../../components/AppParagraphLink/AppParagraphLink.atom', () => ({
  AppParagraphLinkAtom: () => null,
}));
vi.mock('../../../components/Button/Button.atom', () => ({
  ButtonAtom: ({
    children,
    onClick,
    disabled,
  }: {
    children: React.ReactNode;
    onClick: () => void;
    disabled?: boolean;
  }) => (
    <button onClick={onClick} disabled={disabled}>
      {children}
    </button>
  ),
}));
const account = (description = 'A', account_id = 'a') =>
  ({ account_id, description, vanity_url: null }) as SafeStylistAccountWire;
const setup = (description = 'A') => {
  const client = new QueryClient({
    defaultOptions: { mutations: { retry: false } },
  });
  client.setQueryData(queryKeys.account.current, {
    id: 'user-a',
    stylist_account: account(description),
  });
  const wrap = (node: React.ReactNode) => (
    <QueryClientProvider client={client}>{node}</QueryClientProvider>
  );
  return { client, wrap };
};

beforeEach(() => {
  resetLeaveGuardForTests();
  localStorage.setItem('authorization', 'test-token');
  sessionState.pending = false;
  sessionState.userId = 'user-a';
  sessionState.error = null;
  sessionState.error = null;
  mutate.mockReset();
  mutate.mockResolvedValue(undefined);
});
describe('public bio editor', () => {
  it('guards a focused dirty draft and does not save it after an explicit discard', () => {
    const { wrap } = setup();
    const view = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    fireEvent.change(screen.getByLabelText('bio'), { target: { value: 'B' } });
    const proceed = vi.fn();
    expect(requestLeave(null, proceed)).toBe(false);
    resolveLeavePrompt('cancel');
    expect(screen.getByLabelText('bio')).toHaveValue('B');
    expect(requestLeave(null, proceed)).toBe(false);
    resolveLeavePrompt('confirm');
    expect(proceed).toHaveBeenCalledOnce();
    view.unmount();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('allows leaving after a dirty draft saves successfully', async () => {
    const { wrap } = setup();
    render(wrap(<PublicBioEditorOrganism stylistAccount={account()} />));
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'B' } });
    expect(requestLeave(null, vi.fn())).toBe(false);
    resolveLeavePrompt('cancel');
    fireEvent.blur(field);
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    await waitFor(() => expect(requestLeave(null, vi.fn())).toBe(true));
  });
  it('does not dispatch a queued draft after the user confirms leaving', async () => {
    let resolve!: () => void;
    mutate.mockReturnValueOnce(
      new Promise<void>(done => {
        resolve = done;
      })
    );
    const { wrap } = setup();
    const view = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'B' } });
    fireEvent.blur(field);
    await waitFor(() => expect(mutate).toHaveBeenCalledOnce());
    fireEvent.change(field, { target: { value: 'C' } });
    fireEvent.blur(field);
    expect(requestLeave(null, vi.fn())).toBe(false);
    resolveLeavePrompt('confirm');
    view.unmount();
    await act(async () => resolve());
    expect(mutate).toHaveBeenCalledOnce();
  });
  it('queues a reversion behind a slow save and preserves a newer draft on refetch', async () => {
    let resolve!: () => void;
    mutate.mockReturnValueOnce(
      new Promise<void>(done => {
        resolve = done;
      })
    );
    const { wrap } = setup();
    const view = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'B' } });
    fireEvent.blur(field);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    fireEvent.change(field, { target: { value: 'A' } });
    view.rerender(
      wrap(<PublicBioEditorOrganism stylistAccount={account('B')} />)
    );
    expect(field).toHaveValue('A');
    fireEvent.blur(field);
    await act(async () => resolve());
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls.map(([value]) => value.bio.description)).toEqual([
      'B',
      'A',
    ]);
  });
  it('retries the latest draft after failure', async () => {
    mutate.mockRejectedValueOnce(new Error('offline'));
    const { wrap } = setup();
    render(wrap(<PublicBioEditorOrganism stylistAccount={account()} />));
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'B' } });
    fireEvent.blur(field);
    await screen.findByText('retry');
    fireEvent.change(field, { target: { value: 'C' } });
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    expect(mutate.mock.calls[1]?.[0].bio.description).toBe('C');
  });
  it('flushes a draft on navigation but not into another identity', async () => {
    const { client, wrap } = setup();
    const view = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    fireEvent.change(screen.getByLabelText('bio'), { target: { value: 'B' } });
    view.unmount();
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    const second = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    fireEvent.change(screen.getByLabelText('bio'), { target: { value: 'C' } });
    client.setQueryData(queryKeys.account.current, {
      stylist_account: account('X', 'other'),
    });
    second.unmount();
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  it('does not dispatch a queued draft while session identity is being checked or has changed', async () => {
    let resolve!: () => void;
    mutate.mockReturnValueOnce(
      new Promise<void>(done => {
        resolve = done;
      })
    );
    const { wrap } = setup();
    const view = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'B' } });
    fireEvent.blur(field);
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(1));
    fireEvent.change(field, { target: { value: 'C' } });
    fireEvent.blur(field);
    sessionState.pending = true;
    view.rerender(wrap(<PublicBioEditorOrganism stylistAccount={account()} />));
    await act(async () => resolve());
    await waitFor(() => expect(screen.getByText('retry')).toBeInTheDocument());
    expect(mutate).toHaveBeenCalledTimes(1);
    sessionState.pending = false;
    sessionState.userId = 'user-b';
    view.rerender(wrap(<PublicBioEditorOrganism stylistAccount={account()} />));
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(screen.getByText('retry')).toBeInTheDocument());
    expect(mutate).toHaveBeenCalledTimes(1);
  });
  it('protects a draft when session verification blocks its flush and permits explicit discard', async () => {
    const { wrap } = setup();
    const view = render(
      wrap(<PublicBioEditorOrganism stylistAccount={account()} />)
    );
    fireEvent.change(screen.getByLabelText('bio'), { target: { value: 'B' } });
    sessionState.pending = true;
    view.rerender(wrap(<PublicBioEditorOrganism stylistAccount={account()} />));
    const proceed = vi.fn();
    expect(requestLeave('/elsewhere', proceed)).toBe(false);
    expect(getLeavePrompt()?.message).toBe('bioUnsaved');
    resolveLeavePrompt('cancel');
    expect(screen.getByLabelText('bio')).toHaveValue('B');
    expect(mutate).not.toHaveBeenCalled();
    expect(requestLeave('/elsewhere', proceed)).toBe(false);
    resolveLeavePrompt('confirm');
    expect(proceed).toHaveBeenCalledOnce();
    view.unmount();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('protects a failed save until a successful retry', async () => {
    mutate.mockRejectedValueOnce(new Error('offline'));
    const { wrap } = setup();
    render(wrap(<PublicBioEditorOrganism stylistAccount={account()} />));
    const field = screen.getByLabelText('bio');
    fireEvent.change(field, { target: { value: 'B' } });
    fireEvent.blur(field);
    await screen.findByText('retry');
    expect(requestLeave('/elsewhere', vi.fn())).toBe(false);
    resolveLeavePrompt('cancel');
    fireEvent.click(screen.getByText('retry'));
    await waitFor(() => expect(mutate).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(requestLeave('/elsewhere', vi.fn())).toBe(true));
  });
  it('disables private-note publication while the identity is unverified', () => {
    const { wrap } = setup();
    const view = render(
      wrap(
        <PublicBioEditorOrganism
          stylistAccount={account('')}
          mode='confirm-publication'
          initialDraft='private'
        />
      )
    );
    expect(screen.getByText('publish')).toBeEnabled();
    sessionState.pending = true;
    view.rerender(
      wrap(
        <PublicBioEditorOrganism
          stylistAccount={account('')}
          mode='confirm-publication'
          initialDraft='private'
        />
      )
    );
    expect(screen.getByText('publish')).toBeDisabled();
    sessionState.pending = false;
    sessionState.error = { status: 500 };
    view.rerender(
      wrap(
        <PublicBioEditorOrganism
          stylistAccount={account('')}
          mode='confirm-publication'
          initialDraft='private'
        />
      )
    );
    expect(screen.getByText('publish')).toBeDisabled();
    expect(mutate).not.toHaveBeenCalled();
  });
  it('never publishes a private note on blur or unmount', () => {
    const { wrap } = setup();
    const view = render(
      wrap(
        <PublicBioEditorOrganism
          stylistAccount={account('')}
          mode='confirm-publication'
          initialDraft='private'
        />
      )
    );
    fireEvent.blur(screen.getByLabelText('bio'));
    view.unmount();
    expect(mutate).not.toHaveBeenCalled();
  });
});
