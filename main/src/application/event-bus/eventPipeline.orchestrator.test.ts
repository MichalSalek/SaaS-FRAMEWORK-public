import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';

// ---------------------------------------------------------------------------
// Ratchet for recovery-aware eviction in the event pipeline (ADRR §13.1).
//
// Guards two symmetric behaviours for USER_DISABLED (backend 403 for an inactive
// account state routed through the pipeline):
//   - SOFT-DELETED user (deleted_at set = RECOVERABLE/EXPIRED): Stage 1 SUPPRESSES
//     the misleading "Użytkownik został wyłączony" toast (they're recovering, not
//     disabled) AND Stage 3 redirects to /recover (self-service), not login.
//   - GENUINE ban/self-disable (deleted_at===null / user not cached): toast STILL
//     fires + login-eviction (unchanged) — the user gets no explanatory screen.
//
// A future refactor that toasts USER_DISABLED for a recoverable user (redundant
// with /recover), or that stops toasting a genuine ban, breaks one of these.
// Mock the side-effect modules so we assert on calls, not IO. `vi.hoisted` so the
// spies exist when the (hoisted) vi.mock factories reference them.
// ---------------------------------------------------------------------------

const { pushNewSnackbar, redirectToAction, resetUserSlice, getQueryData } =
  vi.hoisted(() => ({
    pushNewSnackbar: vi.fn(() => undefined),
    redirectToAction: vi.fn(
      async (_arg: { routePath: string; query?: string }) => undefined
    ),
    resetUserSlice: vi.fn(() => undefined),
    getQueryData: vi.fn(() => undefined as unknown),
  }));

vi.mock('../app-snackbar/appSnackbar.possibilities.api', () => ({
  pushNewSnackbar,
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
