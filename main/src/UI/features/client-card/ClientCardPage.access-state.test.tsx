import type { ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import { ClientCardPageComposition } from './ClientCardPage.composition';

const mock = vi.hoisted(() => ({
  plan: 'FREE',
  readNote: vi.fn(),
  contactEnabled: vi.fn(),
  crmEnabled: vi.fn(),
  visitsEnabled: vi.fn(),
  setTitle: vi.fn(),
}));
vi.mock('next/router', () => ({
  useRouter: () => ({ query: {}, push: vi.fn() }),
}));
vi.mock('next-intl', () => ({
  useTranslations: (ns: string) => (key: string) => `${ns}:${key}`,
}));
vi.mock('@kernel/domain/pricing/effective-plan', () => ({
  getEffectivePricingPlan: (account: { plan: string }) => account.plan,
}));
vi.mock('../../shared/hooks/useCurrentUserAccount', () => ({
  useCurrentUserAccount: () => ({
    data: { stylist_account: { plan: mock.plan } },
    isLoading: false,
  }),
}));
vi.mock('../../layouts/AppLayout.composition', () => ({
  AppLayoutComposition: ({ children }: { children: ReactNode }) => (
    <>{children}</>
  ),
}));
vi.mock('../../layouts/useAppBarTitle.composition', () => ({
  useAppBarTitle: mock.setTitle,
}));
vi.mock('../../../application/analytics/posthog-client', () => ({
  capturePosthog: vi.fn(),
}));
vi.mock('../shared/upsell/usePurchaseResumeCapture', () => ({
  usePurchaseResumeCapture: () => vi.fn(),
}));
vi.mock('../../../domain/visit/visitIO.possibilities.api', () => ({
  getClientImportantNote_IO: mock.readNote,
  upsertClientImportantNote_IO: vi.fn(),
}));
vi.mock('./hooks/useClientContactForStylist', () => ({
  useClientContactForStylist: (_id: string, enabled: boolean) => {
    mock.contactEnabled(enabled);
    return {
      data: { client_name: 'Cached private client' },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock('../shared/client-card/hooks/useClientCrmNote', () => ({
  useClientCrmNote: (_id: string, enabled: boolean) => {
    mock.crmEnabled(enabled);
    return {
      data: { note: 'private CRM', updatedAt: null },
      isLoading: false,
      isError: false,
      isFetching: false,
      refetch: vi.fn(),
    };
  },
  useDeleteClientCrmNote: () => ({ mutate: vi.fn() }),
  useUpsertClientCrmNote: () => ({ mutate: vi.fn(), reset: vi.fn() }),
}));
vi.mock('./hooks/useClientVisits', () => ({
  useClientVisits: (_id: string, enabled: boolean) => {
    mock.visitsEnabled(enabled);
    return {
      visits: [],
      expiredSessions: [],
      hasData: false,
      refetch: vi.fn(),
    };
  },
}));
vi.mock('./hooks/useVisitMutations', () => ({
  useCreateManualVisit: () => ({ mutateAsync: vi.fn() }),
  useDeleteManualVisit: () => ({ mutateAsync: vi.fn() }),
  useRemoveVisitResultPhoto: () => ({ mutateAsync: vi.fn() }),
  useUpdateVisitNote: () => ({ mutateAsync: vi.fn() }),
}));
vi.mock('../../components/Skeleton/Skeleton.atom', () => ({
  SkeletonAtom: () => <div data-testid='skeleton' />,
}));
vi.mock('../../components/AppHero/AppHero.organism', () => ({
  AppHeroOrganism: ({ title }: { title: ReactNode }) => <h1>{title}</h1>,
}));
vi.mock('../../components/ErrorState/ErrorState.molecule', () => ({
  ErrorStateMolecule: ({
    message,
    retryLabel,
    onRetry,
  }: {
    message: string;
    retryLabel?: string;
    onRetry?: () => void;
  }) => (
    <div role='alert'>
      {message}
      {onRetry && <button onClick={onRetry}>{retryLabel}</button>}
    </div>
  ),
}));
vi.mock('../../components/Button/LinkButton.atom', () => ({
  LinkButtonAtom: ({
    href,
    children,
  }: {
    href: string;
    children: ReactNode;
  }) => <a href={href}>{children}</a>,
}));
vi.mock('../../components/PageColumns/PageColumns.molecule', () => ({
  PageColumnsMolecule: ({
    main,
    aside,
  }: {
    main: ReactNode;
    aside: ReactNode;
  }) => (
    <>
      {main}
      {aside}
    </>
  ),
}));
vi.mock('./ClientCardPage.important-note.organism', async () => {
  const { useClientImportantNote } =
    await import('../shared/notes/hooks/useClientImportantNote');
  const { useState } = await import('react');
  return {
    ImportantNoteSectionOrganism: ({
      clientUserId,
    }: {
      clientUserId: string;
    }) => {
      const query = useClientImportantNote(clientUserId);
      const [draft, setDraft] = useState('');
      return (
        <div>
          <span>important:{query.data?.note}</span>
          <textarea
            aria-label='important draft'
            value={draft}
            onChange={event => setDraft(event.target.value)}
          />
        </div>
      );
    },
  };
});
vi.mock('./ClientCardPage.locked.organism', () => ({
  ClientCardLockedOrganism: () => <div>plan lock</div>,
}));
vi.mock('./ClientCardPage.parts.organism', () => ({
  ClientProfileHeroOrganism: () => <div>private hero</div>,
  ContactSectionOrganism: () => <div>private contact</div>,
}));
vi.mock('./ClientCardPage.crm-note.organism', () => ({
  CrmNoteSectionOrganism: () => <div>private CRM</div>,
}));
vi.mock('./ClientCardPage.history.organism', () => ({
  HistorySectionOrganism: () => <div>private history</div>,
}));
vi.mock('./ClientCardPage.expired-sessions.molecule', () => ({
  ExpiredSessionsMolecule: () => <div>private expired</div>,
}));
vi.mock('./ClientCardPage.manual-visit.molecule', () => ({
  ManualVisitComposerMolecule: () => <button>Add visit</button>,
}));

const clientId = 'client-1';
const note = { note: 'private note', updatedAt: null };
const denial = () =>
  Object.assign(new Error('not paired'), {
    httpError: { event: APP_EVENTS.INFO.CLIENT.NOT_PAIRED_WITH_CLIENT },
  });
const createClient = () =>
  new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
function mount(client = createClient()) {
  return render(
    <QueryClientProvider client={client}>
      <ClientCardPageComposition clientUserId={clientId} />
    </QueryClientProvider>
  );
}

beforeEach(() => {
  mock.plan = 'FREE';
  mock.readNote.mockReset();
  vi.clearAllMocks();
});
afterEach(cleanup);

describe('client card access state', () => {
  it.each(['FREE', 'PRO'])(
    'keeps %s private fields unmounted until availability is known',
    async plan => {
      mock.plan = plan;
      mock.readNote.mockReturnValue(new Promise(() => {}));
      mount();
      expect(screen.getAllByTestId('skeleton').length).toBeGreaterThan(0);
      expect(screen.queryByText('private contact')).toBeNull();
      expect(screen.queryByText('important:private note')).toBeNull();
      expect(screen.queryByRole('button', { name: 'Add visit' })).toBeNull();
      expect(mock.contactEnabled).toHaveBeenLastCalledWith(false);
      expect(mock.crmEnabled).toHaveBeenLastCalledWith(false);
      expect(mock.visitsEnabled).toHaveBeenLastCalledWith(false);
    }
  );

  it.each(['FREE', 'PRO'])(
    'shows one unavailable state for denied %s and no private fields',
    async plan => {
      mock.plan = plan;
      mock.readNote.mockRejectedValue(denial());
      mount();
      expect(await screen.findByRole('alert')).toHaveTextContent(
        'events:NOT_PAIRED_WITH_CLIENT'
      );
      expect(
        screen.getByRole('heading', { name: 'clientCard:title' })
      ).toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: 'clientCard:unavailableAction' })
      ).toHaveAttribute('href', '/app/clients');
      expect(screen.queryByRole('button')).toBeNull();
      expect(screen.queryByText('private contact')).toBeNull();
      expect(screen.queryByText('plan lock')).toBeNull();
      expect(mock.contactEnabled).toHaveBeenLastCalledWith(false);
    }
  );

  it.each(['FREE', 'PRO'])(
    'loads the important note for connected %s with plan-specific card access',
    async plan => {
      mock.plan = plan;
      mock.readNote.mockResolvedValue(note);
      mount();
      expect(
        await screen.findByText('important:private note')
      ).toBeInTheDocument();
      expect(mock.readNote).toHaveBeenCalledTimes(1);
      expect(Boolean(screen.queryByText('plan lock'))).toBe(plan === 'FREE');
      expect(Boolean(screen.queryByRole('button', { name: 'Add visit' }))).toBe(
        plan === 'PRO'
      );
      expect(mock.contactEnabled).toHaveBeenLastCalledWith(plan === 'PRO');
    }
  );

  it('keeps a transient failure retryable and loads the card after retry', async () => {
    mock.plan = 'PRO';
    mock.readNote
      .mockRejectedValueOnce(new Error('network'))
      .mockResolvedValueOnce(note);
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'clientCard:importantNoteLoadError'
    );
    fireEvent.click(screen.getByRole('button', { name: 'buttons:retry' }));
    expect(
      await screen.findByText('important:private note')
    ).toBeInTheDocument();
    expect(mock.readNote).toHaveBeenCalledTimes(2);
  });

  it('does not treat an unrelated forbidden event as a pairing denial', async () => {
    mock.plan = 'PRO';
    mock.readNote.mockRejectedValue(
      Object.assign(new Error('forbidden'), {
        httpError: { event: 'OTHER_FORBIDDEN' },
      })
    );
    mount();
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'clientCard:importantNoteLoadError'
    );
    expect(
      screen.getByRole('button', { name: 'buttons:retry' })
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'clientCard:unavailableAction' })
    ).toBeNull();
    expect(mock.contactEnabled).toHaveBeenLastCalledWith(false);
  });

  it('preserves the mounted draft across a failed background refresh and recovery', async () => {
    mock.plan = 'PRO';
    let reject!: (error: Error) => void;
    mock.readNote
      .mockReturnValueOnce(
        new Promise((_resolve, fail) => {
          reject = fail;
        })
      )
      .mockResolvedValueOnce(note);
    const client = createClient();
    const key = queryKeys.client.importantNote(clientId);
    client.setQueryData(key, note, { updatedAt: Date.now() - 60_000 });
    mount(client);
    const draft = await screen.findByRole('textbox', {
      name: 'important draft',
    });
    fireEvent.change(draft, { target: { value: 'unsaved text' } });
    await waitFor(() => expect(mock.readNote).toHaveBeenCalledTimes(1));
    reject(
      Object.assign(new Error('unavailable'), {
        httpError: { event: 'SERVER_ERROR' },
      })
    );
    await waitFor(() =>
      expect(client.getQueryState(key)?.status).toBe('error')
    );
    expect(screen.getByRole('textbox', { name: 'important draft' })).toBe(
      draft
    );
    expect(draft).toHaveValue('unsaved text');
    expect(screen.queryByRole('alert')).toBeNull();
    expect(mock.contactEnabled).toHaveBeenLastCalledWith(true);
    await act(async () => {
      await client.refetchQueries({ queryKey: key });
    });
    expect(client.getQueryState(key)?.status).toBe('success');
    expect(screen.getByRole('textbox', { name: 'important draft' })).toBe(
      draft
    );
    expect(draft).toHaveValue('unsaved text');
  });

  it('removes previously cached private fields as soon as a refetch confirms denial', async () => {
    mock.plan = 'PRO';
    let reject!: (error: Error) => void;
    mock.readNote.mockReturnValue(
      new Promise((_resolve, fail) => {
        reject = fail;
      })
    );
    const client = createClient();
    client.setQueryData(queryKeys.client.importantNote(clientId), note, {
      updatedAt: Date.now() - 60_000,
    });
    mount(client);
    expect(await screen.findByText('private contact')).toBeInTheDocument();
    await waitFor(() => expect(mock.readNote).toHaveBeenCalledTimes(1));
    reject(denial());
    expect(await screen.findByRole('alert')).toHaveTextContent(
      'events:NOT_PAIRED_WITH_CLIENT'
    );
    expect(screen.queryByText('important:private note')).toBeNull();
    expect(screen.queryByText('private contact')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Add visit' })).toBeNull();
    expect(mock.contactEnabled).toHaveBeenLastCalledWith(false);
    expect(mock.setTitle).toHaveBeenLastCalledWith('clientCard:title');
  });
});
