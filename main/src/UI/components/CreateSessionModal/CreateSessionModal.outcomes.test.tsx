import { act, fireEvent, render, screen } from '@testing-library/react';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it, vi } from 'vitest';
import messages from '../../../locales/pl/common.json';
import { CreateSessionModalOrganism } from './CreateSessionModal.organism';

const stylists = [
  {
    id: 'stylist-one',
    name: 'Anna',
    businessName: null,
    avatarUrl: null,
    hasActiveSession: false,
  },
  {
    id: 'stylist-two',
    name: 'Maria',
    businessName: null,
    avatarUrl: null,
    hasActiveSession: false,
  },
];
function show(create: (id: string) => Promise<boolean>, close = vi.fn()) {
  render(
    <NextIntlClientProvider locale='pl' messages={messages}>
      <CreateSessionModalOrganism
        open
        onClose={close}
        stylists={stylists}
        onCreateSession={create}
      />
    </NextIntlClientProvider>
  );
  return close;
}
describe('session creation confirmed outcomes', () => {
  it('closes as soon as creation is confirmed without a success-screen wait', async () => {
    const close = show(vi.fn().mockResolvedValue(true));
    fireEvent.click(screen.getByRole('button', { name: /Anna/ }));
    await act(async () => {});
    expect(close).toHaveBeenCalledOnce();
  });
  it.each(['false', 'rejected'] as const)(
    'keeps the selected chooser usable after a %s result',
    async kind => {
      const create = vi.fn<(id: string) => Promise<boolean>>();
      if (kind === 'false') {
        create.mockResolvedValueOnce(false);
      } else {
        create.mockRejectedValueOnce(new Error('offline'));
      }
      create.mockResolvedValueOnce(true);
      const close = show(create);
      fireEvent.click(screen.getByRole('button', { name: /Anna/ }));
      await act(async () => {});
      expect(close).not.toHaveBeenCalled();
      expect(screen.getByRole('button', { name: /Anna/ })).toBeEnabled();
      fireEvent.click(screen.getByRole('button', { name: /Anna/ }));
      await act(async () => {});
      expect(create).toHaveBeenNthCalledWith(2, 'stylist-one');
      expect(close).toHaveBeenCalledOnce();
    }
  );
  it('prevents another stylist pick while creation is awaiting confirmation', async () => {
    let finish: (result: boolean) => void = () => undefined;
    const create = vi.fn(
      () =>
        new Promise<boolean>(resolve => {
          finish = resolve;
        })
    );
    const close = show(create);
    fireEvent.click(screen.getByRole('button', { name: /Anna/ }));
    const other = screen.getByRole('button', { name: /Maria/ });
    // The rows are NavRows (no disabled look while one create is in
    // flight); what matters is that a second pick does nothing.
    fireEvent.click(other);
    expect(create).toHaveBeenCalledOnce();
    expect(close).not.toHaveBeenCalled();
    await act(async () => finish(true));
    expect(close).toHaveBeenCalledOnce();
  });

  it('at the limit of shared sessions offers only the sessions to close', () => {
    const open = vi.fn();
    render(
      <NextIntlClientProvider locale='pl' messages={messages}>
        <CreateSessionModalOrganism
          open
          onClose={vi.fn()}
          sharedLimitReached={3}
          onOpenSession={open}
          stylists={[
            ...stylists,
            {
              id: 'stylist-shared',
              name: 'Ola',
              businessName: null,
              avatarUrl: null,
              hasActiveSession: true,
              activeSessionId: 'session-shared',
              activeSessionShared: true,
            },
            {
              id: 'stylist-draft',
              name: 'Ewa',
              businessName: null,
              avatarUrl: null,
              hasActiveSession: true,
              activeSessionId: 'session-draft',
              activeSessionShared: false,
            },
          ]}
          onCreateSession={vi.fn()}
        />
      </NextIntlClientProvider>
    );
    expect(screen.getByText('Masz już 3 udostępnione sesje')).toBeVisible();
    // Nothing can be started, and a draft does not count towards the limit.
    expect(screen.queryByRole('button', { name: /Anna/ })).toBeNull();
    expect(screen.queryByRole('button', { name: /Ewa/ })).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: /Ola/ }));
    expect(open).toHaveBeenCalledWith('session-shared');
  });
});
