import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

// ---------------------------------------------------------------------------
// Ratchet for recovery-aware eviction in the event pipeline (USER_DISABLED, a backend 403 for an
// inactive account state):
//   - SOFT-DELETED user (deleted_at set): Stage 1 SUPPRESSES the misleading "disabled" toast and
//     Stage 3 redirects to /recover, not login.
//   - GENUINE ban/self-disable (deleted_at===null or user not cached): toast still fires plus
//     login-eviction.
// Side-effect modules are mocked so we assert on calls, not IO; `vi.hoisted` makes the spies exist
// when the hoisted vi.mock factories reference them.
// ---------------------------------------------------------------------------

const {
  pushNewSnackbar,
  noteEventSuccessToast,
  redirectToAction,
  resetUserSlice,
  getQueryData,
} = vi.hoisted(() => ({
  pushNewSnackbar: vi.fn(() => undefined),
  noteEventSuccessToast: vi.fn(() => undefined),
  redirectToAction: vi.fn(
    async (_arg: { routePath: string; query?: string }) => undefined
  ),
  resetUserSlice: vi.fn(() => undefined),
  getQueryData: vi.fn(() => undefined as unknown),
}));

vi.mock('../app-snackbar/appSnackbar.possibilities.api', () => ({
  pushNewSnackbar,
  noteEventSuccessToast,
}));
vi.mock('../routing/redirections', () => ({ redirectToAction }));
vi.mock('../stores/user-cache', () => ({ resetUserSlice }));
vi.mock('../http/queryClient.config', () => ({
  queryClient: { getQueryData },
}));
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend: vi.fn(() => undefined),
}));
vi.mock('../error-debugger/debugger.utils.api', () => ({
  __debuggerGate: vi.fn(() => undefined),
}));

import { eventPipelineOrchestrator } from './eventPipeline.orchestrator';

const USER_DISABLED = APP_EVENTS.INFO.USER.USER_DISABLED;

describe('eventPipelineOrchestrator — recovery-aware eviction (USER_DISABLED)', () => {
  beforeEach(() => {
    pushNewSnackbar.mockClear();
    redirectToAction.mockClear();
    resetUserSlice.mockClear();
    getQueryData.mockReset();
  });

  it('RECOVERABLE (deleted_at set): suppresses the toast and redirects to /recover', async () => {
    getQueryData.mockReturnValue({ deleted_at: '2026-07-01T00:00:00.000Z' });

    await eventPipelineOrchestrator({ event: USER_DISABLED });

    // No misleading "Użytkownik został wyłączony" toast — /recover self-explains.
    expect(pushNewSnackbar).not.toHaveBeenCalled();
    // Routed to the self-service recovery screen, not login-eviction.
    expect(redirectToAction).toHaveBeenCalledTimes(1);
    expect(redirectToAction.mock.calls[0]?.[0]).toMatchObject({
      routePath: ROUTES_FRONT.USER_RECOVER,
    });
  });

  it('EXPIRED (deleted_at set, recovery_available false): also suppresses the toast', async () => {
    getQueryData.mockReturnValue({
      deleted_at: '2026-01-01T00:00:00.000Z',
      recovery_available: false,
    });

    await eventPipelineOrchestrator({ event: USER_DISABLED });

    expect(pushNewSnackbar).not.toHaveBeenCalled();
    expect(redirectToAction.mock.calls[0]?.[0]).toMatchObject({
      routePath: ROUTES_FRONT.USER_RECOVER,
    });
  });

  it('GENUINE disable (deleted_at===null): toast STILL fires, not routed to /recover', async () => {
    getQueryData.mockReturnValue({ deleted_at: null });

    await eventPipelineOrchestrator({ event: USER_DISABLED });

    expect(pushNewSnackbar).toHaveBeenCalledTimes(1);
    // Positive assertion — `.not.toMatchObject` on calls[0]?.[0] passes TRIVIALLY
    // when redirectToAction is never called (undefined). A genuine ban MUST still
    // evict to login, so assert the call happened AND targets USER_LOG.
    expect(redirectToAction).toHaveBeenCalledTimes(1);
    expect(redirectToAction.mock.calls[0]?.[0]).toMatchObject({
      routePath: ROUTES_FRONT.USER_LOG,
    });
  });

  it('user not in cache (undefined): safe default — toast fires, not /recover', async () => {
    getQueryData.mockReturnValue(undefined);

    await eventPipelineOrchestrator({ event: USER_DISABLED });

    expect(pushNewSnackbar).toHaveBeenCalledTimes(1);
    // Safe default: a not-cached user is treated as genuine eviction → login
    // (positive assertion so a skipped-redirect regression can't pass green).
    expect(redirectToAction).toHaveBeenCalledTimes(1);
    expect(redirectToAction.mock.calls[0]?.[0]).toMatchObject({
      routePath: ROUTES_FRONT.USER_LOG,
    });
  });

  it('non-USER_DISABLED event is unaffected (toast fires normally)', async () => {
    getQueryData.mockReturnValue({ deleted_at: '2026-07-01T00:00:00.000Z' });

    await eventPipelineOrchestrator({
      event: APP_EVENTS.INFO.USER.ACCOUNT_REACTIVATED,
    });

    // Suppression is scoped to USER_DISABLED — a soft-deleted user still gets
    // other toasts (e.g. the reactivation success on /recover).
    expect(pushNewSnackbar).toHaveBeenCalledTimes(1);
  });
});

describe('screen-owned success routing', () => {
  it('suppresses only app success and preserves warning and admin confirmation', async () => {
    const event = APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CREATED;
    pushNewSnackbar.mockClear();
    window.history.replaceState({}, '', '/pl/app/sessions');
    await eventPipelineOrchestrator({
      event,
      payload: { snackbarColor: 'success' },
    });
    expect(pushNewSnackbar).not.toHaveBeenCalled();
    await eventPipelineOrchestrator({
      event,
      payload: { snackbarColor: 'warning' },
    });
    expect(pushNewSnackbar).toHaveBeenCalledWith(event, 'warning');
    pushNewSnackbar.mockClear();
    window.history.replaceState({}, '', '/pl/app/admin/users');
    await eventPipelineOrchestrator({
      event,
      payload: { snackbarColor: 'success' },
    });
    expect(pushNewSnackbar).toHaveBeenCalledWith(event, 'success');
    window.history.replaceState({}, '', '/');
  });

  it('a declared screen or silent owner skips the success toast anywhere, admin included', async () => {
    const event = APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED;
    window.history.replaceState({}, '', '/pl/app/admin/support');
    for (const successFeedback of ['screen', 'silent'] as const) {
      pushNewSnackbar.mockClear();
      await eventPipelineOrchestrator({
        event,
        payload: { snackbarColor: 'success', successFeedback },
      });
      expect(pushNewSnackbar).not.toHaveBeenCalled();
    }
    pushNewSnackbar.mockClear();
    await eventPipelineOrchestrator({
      event,
      payload: { snackbarColor: 'success', successFeedback: 'event' },
    });
    expect(pushNewSnackbar).toHaveBeenCalledWith(event, 'success');
    window.history.replaceState({}, '', '/');
  });

  it('a declared owner never silences an error or a redirect', async () => {
    pushNewSnackbar.mockClear();
    resetUserSlice.mockClear();
    redirectToAction.mockClear();
    getQueryData.mockReturnValue({ deleted_at: null });
    window.history.replaceState({}, '', '/pl/app/admin/users');
    await eventPipelineOrchestrator({
      event: USER_DISABLED,
      payload: { snackbarColor: 'warning', successFeedback: 'screen' },
    });
    expect(pushNewSnackbar).toHaveBeenCalledWith(USER_DISABLED, 'warning');
    expect(resetUserSlice).toHaveBeenCalledTimes(1);
    expect(redirectToAction).toHaveBeenCalledTimes(1);
    window.history.replaceState({}, '', '/');
  });
});

describe('admin action on another user', () => {
  it('ADMIN_USER_DISABLED (admin disabled someone else) never evicts the admin', async () => {
    resetUserSlice.mockClear();
    redirectToAction.mockClear();
    getQueryData.mockReturnValue({ deleted_at: null, role_id: 'MASTER_ADMIN' });
    window.history.replaceState({}, '', '/pl/app/admin/users');
    for (const event of [
      APP_EVENTS.INFO.ADMIN.ADMIN_USER_DISABLED,
      APP_EVENTS.INFO.ADMIN.ADMIN_USER_SESSIONS_REVOKED,
    ]) {
      await eventPipelineOrchestrator({
        event,
        payload: { snackbarColor: 'success' },
      });
    }
    expect(resetUserSlice).not.toHaveBeenCalled();
    expect(redirectToAction).not.toHaveBeenCalled();
    window.history.replaceState({}, '', '/');
  });
});
