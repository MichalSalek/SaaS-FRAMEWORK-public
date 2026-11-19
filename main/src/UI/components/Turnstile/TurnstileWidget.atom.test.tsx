import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ButtonHTMLAttributes } from 'react';
import { TurnstileWidgetAtom } from './TurnstileWidget.atom';

vi.mock('next-intl', () => ({ useTranslations: () => (key: string) => key }));
vi.mock('../Button/Button.atom', () => ({
  ButtonAtom: ({
    variant: _variant,
    size: _size,
    ...props
  }: ButtonHTMLAttributes<HTMLButtonElement> & {
    variant?: string;
    size?: string;
  }) => <button {...props} />,
}));
vi.mock('../../shared/interaction/trusted-interaction', () => ({
  onTrustedInteraction: (callback: () => void) => {
    callback();
    return () => undefined;
  },
}));
vi.mock('../../../application/security/turnstile.config', () => ({
  TURNSTILE_CONFIG: { SITE_KEY: 'test-site-key' },
  isTurnstileEnabled: () => true,
}));

const report = vi.hoisted(() => vi.fn());
vi.mock(
  '../../../application/error-debugger/errorHandler.possibilities.api',
  () => ({ reportIssueFrontend: report })
);

type Options = Parameters<NonNullable<Window['turnstile']>['render']>[1];
const attempts: Options[] = [];
const api = {
  render: vi.fn((_host: HTMLElement, options: Options) => {
    attempts.push(options);
    return `widget-${attempts.length}`;
  }),
  reset: vi.fn(),
  remove: vi.fn(),
};

beforeEach(() => {
  vi.clearAllMocks();
  attempts.length = 0;
  window.turnstile = api;
});
afterEach(() => {
  cleanup();
});

async function mountWidget() {
  const onToken = vi.fn();
  const view = render(<TurnstileWidgetAtom onToken={onToken} resetNonce={0} />);
  await waitFor(() => expect(attempts).toHaveLength(1));
  return { onToken, ...view };
}

describe('Turnstile recovery', () => {
  it('keeps the retry visible when the interactive challenge times out', async () => {
    const { onToken } = await mountWidget();
    act(() => attempts[0]?.['timeout-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(screen.getByRole('button', { name: 'retry' })).toBeVisible();
  });

  it('replaces a failed challenge with a visible widget and discards the old callbacks', async () => {
    const { onToken } = await mountWidget();
    const old = attempts[0];
    act(() => void old?.['error-callback']('300030'));
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(attempts).toHaveLength(2));
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    expect(attempts[1]?.appearance).toBe('always');
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => old?.callback('stale-token'));
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => attempts[1]?.callback('fresh-token'));
    expect(onToken).toHaveBeenLastCalledWith('fresh-token');
  });

  it('offers another retry after repeated failures and an unsupported browser', async () => {
    await mountWidget();
    act(() => attempts[0]?.['unsupported-callback']());
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(attempts).toHaveLength(2));
    act(() => void attempts[1]?.['error-callback']('300030'));
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(attempts).toHaveLength(3));
    expect(attempts[2]?.appearance).toBe('always');
  });

  it('invalidates solved tokens on expiry and after a submit', async () => {
    const { onToken, rerender } = await mountWidget();
    act(() => attempts[0]?.callback('first-token'));
    act(() => attempts[0]?.['expired-callback']());
    expect(onToken).toHaveBeenLastCalledWith(null);
    act(() => attempts[0]?.callback('second-token'));
    rerender(<TurnstileWidgetAtom onToken={onToken} resetNonce={1} />);
    expect(onToken).toHaveBeenLastCalledWith(null);
    expect(api.reset).toHaveBeenCalledWith('widget-1');
  });

  it('counts a submit reset as a new verification attempt', async () => {
    const { onToken, rerender } = await mountWidget();
    act(() => void attempts[0]?.['error-callback']('300030'));
    rerender(<TurnstileWidgetAtom onToken={onToken} resetNonce={1} />);
    act(() => void attempts[0]?.['error-callback']('300030'));
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { phase: 'challenge', attempt: 2, error_code: '300030' },
      })
    );
  });

  it('records a sanitized vendor code and the manual retry number without duplicate callbacks', async () => {
    await mountWidget();
    act(() => void attempts[0]?.['error-callback']('300030'));
    act(() => void attempts[0]?.['error-callback']('300030'));
    expect(report).toHaveBeenCalledTimes(1);
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { phase: 'challenge', attempt: 1, error_code: '300030' },
      })
    );
    fireEvent.click(screen.getByRole('button', { name: 'retry' }));
    await waitFor(() => expect(attempts).toHaveLength(2));
    act(() => void attempts[1]?.['error-callback']('600010'));
    expect(report).toHaveBeenLastCalledWith(
      expect.objectContaining({
        payload: { phase: 'challenge', attempt: 2, error_code: '600010' },
      })
    );
    act(() => void attempts[0]?.['error-callback']('110200'));
    expect(report).toHaveBeenCalledTimes(2);
  });

  it('removes the widget on unmount and ignores a delayed success', async () => {
    const { onToken, unmount } = await mountWidget();
    unmount();
    expect(api.remove).toHaveBeenCalledWith('widget-1');
    act(() => attempts[0]?.callback('too-late'));
    expect(onToken).not.toHaveBeenCalledWith('too-late');
  });
});
