import { act, render, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { toastMethods } = vi.hoisted(() => ({
  toastMethods: {
    success: vi.fn(() => 'success-toast'),
    info: vi.fn(() => 'info-toast'),
    warning: vi.fn(() => 'warning-toast'),
    error: vi.fn(() => 'error-toast'),
  },
}));

vi.mock('sonner', () => ({
  toast: toastMethods,
  Toaster: () => null,
}));

const { intlState } = vi.hoisted(() => ({
  intlState: { messages: { events: {} } as Record<string, unknown> },
}));

vi.mock('../../i18n/events-messages', () => ({
  loadEventsMessages: () =>
    Promise.resolve({ GENERAL_ERROR: 'lazy:GENERAL_ERROR' }),
}));

vi.mock('next-intl', () => ({
  useMessages: () => intlState.messages,
  useLocale: () => 'pl',
  useTranslations: (namespace?: string) =>
    Object.assign(
      (key: string) =>
        namespace === 'events' ? `translated:${key}` : `a11y:${key}`,
      {
        // The controller probes the events namespace with `t.has(<event key>)`:
        // a translator over a namespace the page did not ship answers false.
        has: (key: string) =>
          namespace === 'events' &&
          key !== '' &&
          'events' in intlState.messages,
      }
    ),
}));

import { useSnackbarStore } from '../appSnackbar.store';
import { AppSnackbarsController } from './AppSnackbars.controller';

describe('AppSnackbarsController — active-toast deduplication contract', () => {
  beforeEach(() => {
    intlState.messages = { events: {} };
    useSnackbarStore.setState({ snackbars: [] });
    for (const method of Object.values(toastMethods)) {
      method.mockClear();
    }
  });

  it('uses the same Sonner id for an interleaved A -> B -> A sequence', async () => {
    render(<AppSnackbarsController />);

    act(() => {
      const { push } = useSnackbarStore.getState();
      push({ message: 'GENERAL_ERROR', color: 'error' });
      push({ message: 'VALIDATION_FAILED', color: 'warning' });
      push({ message: 'GENERAL_ERROR', color: 'error' });
    });

    await waitFor(() => {
      expect(useSnackbarStore.getState().snackbars).toHaveLength(0);
      expect(toastMethods.error).toHaveBeenCalledTimes(2);
      expect(toastMethods.warning).toHaveBeenCalledTimes(1);
    });

    expect(toastMethods.error).toHaveBeenNthCalledWith(
      1,
      expect.anything(),
      expect.objectContaining({ id: 'app-snackbar:translated:GENERAL_ERROR' })
    );
    expect(toastMethods.error).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ id: 'app-snackbar:translated:GENERAL_ERROR' })
    );
    expect(toastMethods.warning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        id: 'app-snackbar:translated:VALIDATION_FAILED',
      })
    );
  });

  it('collapses an event key and a screen string that read the same', async () => {
    intlState.messages = {};
    render(<AppSnackbarsController />);

    act(() => {
      const { push } = useSnackbarStore.getState();
      push({ message: 'GENERAL_ERROR', color: 'success' });
      push({ message: 'lazy:GENERAL_ERROR', color: 'success' });
    });

    await waitFor(() => {
      expect(toastMethods.success).toHaveBeenCalledTimes(2);
    });
    for (const call of toastMethods.success.mock.calls as unknown as [
      unknown,
      { id: string },
    ][]) {
      expect(call[1].id).toBe('app-snackbar:lazy:GENERAL_ERROR');
    }
  });

  it('loads the toast strings on first use when the page did not ship them', async () => {
    intlState.messages = {};
    render(<AppSnackbarsController />);

    act(() => {
      useSnackbarStore
        .getState()
        .push({ message: 'GENERAL_ERROR', color: 'error' });
      useSnackbarStore
        .getState()
        .push({ message: 'Gotowy tekst', color: 'success' });
    });

    await waitFor(() => {
      expect(useSnackbarStore.getState().snackbars).toHaveLength(0);
    });
    expect(toastMethods.error).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ message: 'lazy:GENERAL_ERROR' }),
      }),
      expect.anything()
    );
    expect(toastMethods.success).toHaveBeenCalledWith(
      expect.objectContaining({
        props: expect.objectContaining({ message: 'Gotowy tekst' }),
      }),
      expect.anything()
    );
  });
});
