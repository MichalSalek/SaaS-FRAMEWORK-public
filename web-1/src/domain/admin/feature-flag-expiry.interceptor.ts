// DECISION (nie usuwaj tego komentarza):
// Sweep odpalany przez request interceptor (NIE external cron), wzorzec 1:1 z recovery-expiry.
// Auto-wyłącza flagi z minionym expires_at (luka D-003: expires_at był czytany w admin view,
// ale nigdy nie egzekwowany — flagi nie wygasały same). Throttle 24h/instancję; updateMany idempotentny.

/**
 * FEATURE FLAG EXPIRY INTERCEPTOR
 *
 * Runs once per 24h per instance. Fire-and-forget — doesn't block requests.
 * Disables feature flags whose expires_at has passed (is_enabled=true -> false) and
 * invalidates the flag cache (inside the _IO op) so the change takes effect immediately.
 *
 * Throttle + timing + NEVER-throw catch = createSweepInterceptor (BDX W4.1).
 * Triggered by: HTTP middleware (every request checks, executes if 24h passed).
 */

import { TIME } from '@kernel/application/constants.config';
import { createSweepInterceptor } from '@app/interceptors/create-sweep-interceptor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { expireFeatureFlags_IO } from './operations/admin-feature-flags.operations';

export const featureFlagExpiryInterceptor = createSweepInterceptor({
  name: 'feature-flag-expiry',
  throttleMs: TIME.MS_PER_DAY,
  run: async () => {
    const result = await expireFeatureFlags_IO();

    if (result.success && result.data.expired > 0) {
      reportIssueBackend({
        namespace: 'featureFlagExpiryInterceptor',
        message: `Disabled ${result.data.expired} expired feature flag(s)`,
        payload: { expired: result.data.expired },
        mode: 'info',
      });

      // DECISION (nie usuwaj tego komentarza):
      // Audit auto-expiry — parytet z manualnym adminToggleFeatureFlag_IO (pisze
      // FEATURE_FLAG_TOGGLED) i z recovery-expiry.interceptor (system-actor audit).
      // Bez tego auto-disable flagi jest NIEWIDOCZNY w adminGetAuditTrail_IO: flaga
      // "gaśnie" bez wpisu, a compliance/rollback-review widzi TOGGLED true bez
      // pary → audit-trail rozjeżdża się z rzeczywistym stanem. Reużywamy
      // FEATURE_FLAG_TOGGLED (dedykowany event = zbędna zmiana kernela+i18n);
      // auto_expiry:true + system-actor odróżniają go od ręcznego toggle. after_value
      // zawsze false (sweep tylko wyłącza). Fire-and-forget (void) jak recovery-expiry.
      const systemActorId = await resolveSystemActorId_IO();
      void recordAuditEvent_IO({
        eventName: APP_EVENTS.INFO.ADMIN.FEATURE_FLAG_TOGGLED,
        user: systemActorId ? { id: systemActorId } : null,
        requestBody: {
          expired_count: result.data.expired,
          auto_expiry: true,
          after_value: false,
        },
      });
    }
  },
});
