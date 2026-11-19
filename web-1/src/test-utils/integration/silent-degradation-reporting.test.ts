/**
 * A degraded path may stay graceful and must still call reportIssueBackend.
 * newsletterSubscribe_IO hid DB faults inside SUBSCRIBE_FAILED, which nobody reads.
 * batchResolveLocales then sends the whole batch in the default language.
 * deleteImpersonationBackupByRefId must not swallow a failed delete of a live
 * admin session (DECISION in the source). These need a fault, not an HTTP probe.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { mockDb } from '../mockApiHandler';

vi.mock('@app/debugger/error-handler', () => ({
  reportIssueBackend: vi.fn(),
}));

vi.mock('@app/email-handler/email-transactional', () => ({
  sendTransactionalEmail: vi.fn(async () => true),
}));

import { reportIssueBackend } from '@app/debugger/error-handler';
import { newsletterSubscribe_IO } from '@domain/newsletter/operations/newsletter-subscribe.operations';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import { deleteImpersonationBackupByRefId } from '@domain/admin/impersonation-backup.utils';

const reported = vi.mocked(reportIssueBackend);

type RawStub = Record<string, (...args: never[]) => unknown>;
const rawStub = (fn: unknown): RawStub => fn as RawStub;

const namespacesReported = (): string[] =>
  reported.mock.calls.map(([call]) => call.namespace);

beforeEach(() => {
  reported.mockClear();
});

describe('a degraded path reports its failure', () => {
  it('newsletterSubscribe_IO — a DB fault on the public consent endpoint is logged, not swallowed', async () => {
    mockDb({
      newsletterSubscriber: {
        findUnique: async () => {
          throw new Error('connection terminated unexpectedly');
        },
      },
    });

    const result = await newsletterSubscribe_IO({
      email: 'probe@example.com',
    });

    // Graceful half: still a typed failure, and still an OPAQUE one — the driver
    // message must never reach the client (DATABASE_ERROR maps to a bare 500).
    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
      expect(JSON.stringify(result.error)).not.toContain(
        'connection terminated'
      );
    }

    // Observable half: databaseFailure reported before returning.
    expect(namespacesReported()).toContain('DATABASE_ERROR');
  });

  it('batchResolveLocales — the whole-batch language fallback is logged, not silent', async () => {
    mockDb({
      $queryRaw: rawStub(async () => {
        throw new Error('relation "EventLog" does not exist');
      }),
    });

    const locales = await batchResolveLocales(['usr_1', 'usr_2']);

    // Graceful half: empty map → every caller falls back to the default locale,
    // so the lifecycle mail still goes out. That behaviour is deliberate.
    expect(locales.size).toBe(0);

    // Observable half: the operator can now see WHY everyone got the default.
    expect(namespacesReported()).toContain('EMAIL_LOCALE_BATCH_FALLBACK');
  });

  it('deleteImpersonationBackupByRefId — a failed delete of a live-token row is logged, and stays non-fatal', async () => {
    mockDb({
      impersonationBackup: {
        delete: async () => {
          throw new Error('deadlock detected');
        },
      },
    });

    // Graceful half: the caller (switch-back) must not blow up because cleanup failed.
    await expect(
      deleteImpersonationBackupByRefId('ref_test_0001')
    ).resolves.toBeUndefined();

    expect(namespacesReported()).toContain(
      'IMPERSONATION_BACKUP_DELETE_FAILED'
    );
  });

  it('deleteImpersonationBackupByRefId — a missing row stays silent (idempotent no-op, not a failure)', async () => {
    mockDb({
      impersonationBackup: {
        delete: async () => {
          // Prisma P2025 = "record to delete does not exist" — the documented
          // idempotent case. Reporting it would flood the channel on every
          // repeated switch-back click.
          throw Object.assign(new Error('Record to delete does not exist.'), {
            code: 'P2025',
          });
        },
      },
    });

    await expect(
      deleteImpersonationBackupByRefId('ref_test_0002')
    ).resolves.toBeUndefined();

    expect(namespacesReported()).not.toContain(
      'IMPERSONATION_BACKUP_DELETE_FAILED'
    );
  });
});
