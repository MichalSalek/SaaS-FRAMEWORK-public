/**
 * A failed operation must be a FAILED run (retry in 15 min, counted, visible in admin health),
 * never a completed one that moves `due_at` a whole interval and hides the failure.
 */
import { describe, expect, it, vi } from 'vitest';

const failed = {
  success: false,
  error: { type: 'DATABASE_ERROR', operation: 'x' },
};

vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));
vi.mock('@app/event-log/event-log-io.wrapper', () => ({
  recordAuditEvent_IO: vi.fn(),
}));
vi.mock('@app/event-log/system-actor', () => ({
  resolveSystemActorId_IO: vi.fn(),
}));
vi.mock('@domain/admin/operations/ai-crawler-cleanup.operations', () => ({
  cleanupOldAiCrawlerEvents_IO: vi.fn(async () => failed),
}));
vi.mock('@domain/admin/operations/admin-logs.operations', () => ({
  cleanupOldEventLogs_IO: vi.fn(async () => failed),
}));
vi.mock('@domain/admin/operations/admin-feature-flags.operations', () => ({
  expireFeatureFlags_IO: vi.fn(async () => failed),
}));
vi.mock('@domain/user/operations/user-soft-delete.operations', () => ({
  expireMoveRecoveryWindows_IO: vi.fn(async () => failed),
}));
vi.mock(
  '@domain/newsletter/operations/newsletter-pending-cleanup.operations',
  () => ({
    cleanupStaleNewsletterPending_IO: vi.fn(async () => failed),
  })
);
vi.mock('@app/db/db.client', () => ({
  DB_CLIENT: {
    use: {
      $executeRaw: vi.fn(async () => 0),
      sessionContainer: {
        updateMany: vi.fn(async () => {
          throw new Error('db down');
        }),
      },
    },
  },
}));

import { DB_CLIENT } from '@app/db/db.client';
import { aiCrawlerCleanupJob } from '@domain/admin/ai-crawler-cleanup.interceptor';
import { eventLogCleanupJob } from '@domain/admin/event-log-cleanup.interceptor';
import { featureFlagExpiryJob } from '@domain/admin/feature-flag-expiry.interceptor';
import { recoveryExpiryJob } from '@domain/admin/recovery-expiry.interceptor';
import { newsletterPendingCleanupJob } from '@domain/newsletter/newsletter-pending-cleanup.interceptor';
import { sessionContainerExpiryJob } from '@app/interceptors/session-container-expiry-interceptor';
import { expireStaleSessionContainers } from '@domain/session-container/session-container.expire-sweep';

const context = { signal: new AbortController().signal };

describe('jobs fail their run when the operation fails', () => {
  it.each([
    aiCrawlerCleanupJob,
    eventLogCleanupJob,
    featureFlagExpiryJob,
    recoveryExpiryJob,
    newsletterPendingCleanupJob,
  ])('$name throws on a failed OperationResult', async job => {
    await expect(job.run(context)).rejects.toThrow(
      `${job.name}: operation failed`
    );
  });

  it('session-container-expiry rethrows after reporting', async () => {
    await expect(sessionContainerExpiryJob.run(context)).rejects.toThrow(
      'db down'
    );
  });

  it('session-container-expiry rethrows when extending live deadlines fails', async () => {
    vi.mocked(DB_CLIENT.use.$executeRaw).mockRejectedValueOnce(
      new Error('extension db down')
    );
    await expect(sessionContainerExpiryJob.run(context)).rejects.toThrow(
      'extension db down'
    );
  });

  it('the startup warm-up of the same sweep still swallows the error', async () => {
    await expect(expireStaleSessionContainers()).resolves.toBeUndefined();
  });
});
