/**
 * STRIPE ORPHAN-SUBSCRIPTION SCAN JOB, due every 6 h (scheduler lease, see
 * scheduled-jobs.registry.ts). The scan only writes reconcile rows; the cancels
 * are executed by stripeCancelReconcileJob.
 *
 * DECISION: PRODUCTION ONLY. Non-production environments can reach the same Stripe account as
 * production, but each environment has its own database. A non-production database
 * does not describe production customers (a user deleted on staging is a paying customer in
 * production), so there the scan would read real subscriptions as orphans and queue them for
 * cancellation. The sweep still records its run in every environment, so sweep health does not
 * go stale. (owner)
 */

import { IS_PRODUCTION_ENV } from '@app/environment/environment.utils.api';
import { defineScheduledJob } from '@app/scheduler/scheduled-job';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { scanOrphanedSubscriptions } from './stripe-orphan-subscription.operations';
import { ORPHAN_SCAN_THROTTLE_MS } from './stripe-orphan-subscription.resolver';

export const stripeOrphanSubscriptionScanJob = defineScheduledJob({
  name: 'stripe-orphan-subscription-scan',
  wakesOnTick: true,
  intervalMs: ORPHAN_SCAN_THROTTLE_MS,
  run: async () => {
    if (!IS_PRODUCTION_ENV()) {
      return;
    }
    const result = await scanOrphanedSubscriptions();

    const needsAttention = result.reports.length > 0 || result.capped;
    if (needsAttention || result.enqueued + result.rearmed > 0) {
      reportIssueBackend({
        namespace: 'stripeOrphanSubscriptionScanInterceptor',
        message:
          'Orphan subscription scan finished with subscriptions that need a look',
        payload: result,
        mode: needsAttention ? 'warn' : 'info',
      });
    }
  },
});
