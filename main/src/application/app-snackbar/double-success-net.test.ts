// Dev-only runtime net: an event success toast and a screen success toast for
// one outcome within a second are reported (the static guard sees only
// onSuccess callbacks; this sees every push).

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { reportIssueFrontend } = vi.hoisted(() => ({
  reportIssueFrontend: vi.fn(() => undefined),
}));
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend,
}));

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  noteEventSuccessToast,
  pushNewSnackbar,
} from './appSnackbar.possibilities.api';
import { useSnackbarStore } from './appSnackbar.store';

const EVENT = APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED;
const doubles = () =>
  reportIssueFrontend.mock.calls.filter(
    call =>
      (call as unknown as [{ namespace: string }])[0].namespace ===
      'double success feedback'
  );

describe('double success feedback net (development)', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-10-21T10:00:00Z'));
    reportIssueFrontend.mockClear();
    useSnackbarStore.setState({ snackbars: [] });
  });

  it('the event toast alone is not a double', () => {
    noteEventSuccessToast(EVENT);
    pushNewSnackbar(EVENT, 'success');
    expect(doubles()).toHaveLength(0);
  });

  it('a screen success toast right after the event toast is reported', () => {
    noteEventSuccessToast(EVENT);
    pushNewSnackbar(EVENT, 'success');
    pushNewSnackbar('Odpowiedź wysłana', 'success');
    expect(doubles()).toHaveLength(1);
  });

  it('a screen success toast right before the event toast is reported', () => {
    vi.setSystemTime(new Date('2026-10-21T11:00:00Z'));
    pushNewSnackbar('Odpowiedź wysłana');
    noteEventSuccessToast(EVENT);
    pushNewSnackbar(EVENT, 'success');
    expect(doubles()).toHaveLength(1);
  });

  it('errors and toasts more than a second apart are not doubles', () => {
    vi.setSystemTime(new Date('2026-10-21T12:00:00Z'));
    noteEventSuccessToast(EVENT);
    pushNewSnackbar(EVENT, 'success');
    pushNewSnackbar('Nie udało się', 'error');
    vi.advanceTimersByTime(1500);
    pushNewSnackbar('Skopiowano', 'success');
    expect(doubles()).toHaveLength(0);
    vi.useRealTimers();
  });
});
