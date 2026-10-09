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

vi.mock('next-intl', () => ({
  useTranslations: (namespace: string) =>
    Object.assign(
      (key: string) =>
        namespace === 'events' ? `translated:${key}` : `a11y:${key}`,
      { has: (key: string) => namespace === 'events' && key !== '' }
    ),
}));

import { useSnackbarStore } from '../appSnackbar.store';
import { AppSnackbarsController } from './AppSnackbars.controller';

describe('AppSnackbarsController — active-toast deduplication contract', () => {
  beforeEach(() => {
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
      expect.objectContaining({ id: 'app-snackbar:GENERAL_ERROR' })
    );
    expect(toastMethods.error).toHaveBeenNthCalledWith(
      2,
      expect.anything(),
      expect.objectContaining({ id: 'app-snackbar:GENERAL_ERROR' })
    );
    expect(toastMethods.warning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ id: 'app-snackbar:VALIDATION_FAILED' })
    );
  });
});
