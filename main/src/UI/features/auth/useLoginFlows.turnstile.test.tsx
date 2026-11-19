import { act, renderHook } from '@testing-library/react';
import type { ChangeEvent, FormEvent } from 'react';
import { describe, expect, it, vi } from 'vitest';

const send = vi.hoisted(() => vi.fn());
vi.mock('next/router', () => ({
  useRouter: () => ({
    isReady: true,
    query: {},
    locale: 'pl',
    defaultLocale: 'pl',
  }),
}));
vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../../../application/auth/better-auth-client', () => ({
  signIn: { magicLink: send },
  authClient: { useSession: () => ({ refetch: vi.fn() }) },
}));
vi.mock('../../contexts/AuthContext.composition', () => ({
  useAuth: () => ({ syncLoggedInFromStorage: vi.fn() }),
}));
vi.mock('../../../application/auth/login-confirmation', () => ({
  markLoginStarted: vi.fn(),
}));
import { useLoginFlows } from './useLoginFlows';

describe('magic link Turnstile recovery', () => {
  it('invalidates a possibly spent challenge when the send throws', async () => {
    send
      .mockRejectedValueOnce(new Error('network lost'))
      .mockResolvedValueOnce({ error: null });
    const view = renderHook(() => useLoginFlows({ postLoginTarget: '/app' }));
    act(() => {
      view.result.current.handleEmailChange({
        target: { value: 'a@example.com' },
      } as ChangeEvent<HTMLInputElement>);
      view.result.current.handleTurnstileToken('single-use-token');
    });
    const event = {
      preventDefault: vi.fn(),
    } as unknown as FormEvent<HTMLFormElement>;
    await act(async () => {
      await view.result.current.handleMagicLinkSubmit(event);
    });
    expect(view.result.current.turnstileResetNonce).toBe(1);
    await act(async () => {
      await view.result.current.handleMagicLinkSubmit(event);
    });
    expect(send.mock.calls[1]?.[0].fetchOptions).toBeUndefined();
  });
});
