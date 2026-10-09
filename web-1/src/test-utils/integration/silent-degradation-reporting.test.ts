/**
 * Cross-cutting contract — A DEGRADED PATH MAY BE GRACEFUL, IT MAY NOT BE SILENT.
 *
 * Three unrelated paths shared one failure mode: they caught an error, kept the
 * request alive (correctly — none of them should be fatal), and then reported
 * NOTHING. Each was invisible in a different way and each had a user-visible or
 * security-visible consequence:
 *
 *  1. `newsletterSubscribe_IO` — a PUBLIC, unauthenticated consent-capture endpoint
 *     wrapped every DB fault into `SUBSCRIBE_FAILED { reason }`, and `reason` is
 *     read by nobody (the mapper answers `respondGeneralError(res, undefined)`).
 *     A database outage on the consent endpoint produced zero log lines.
 *  2. `batchResolveLocales` — `catch {}` with a comment. The fallback is right
 *     (the lifecycle mail must go out), but its cost is that the WHOLE batch is
 *     sent in the default language, including recipients who chose EN/DE. The
 *     symptom is visible to users and had no trace at all on our side.
 *  3. `deleteImpersonationBackupByRefId` — `.catch(() => undefined)` on deleting a
 *     row that carries a live ADMIN session token. A silent swallow on this exact
 *     table already cost a TOCTOU double-redeem once (DECISION in the source).
 *
 * These are unreachable from a live HTTP probe (they need a DB outage, a broken raw
 * query, and a failed delete respectively), so the guard lives here. Each case
 * asserts BOTH halves of the contract: the graceful outcome is preserved AND the
 * failure reached `reportIssueBackend`.
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
