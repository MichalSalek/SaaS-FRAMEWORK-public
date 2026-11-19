import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { DB_CLIENT } from '@app/db/db.client';
import type { LifecycleEmailParams } from './email-transport';

export async function reportTransportFailure(
  params: LifecycleEmailParams,
  error: unknown,
  attempts: number,
  transport: string
): Promise<false> {
  const deadLetterOnFailure = params.deadLetterOnFailure ?? true;

  // Both failed — log; durable dead-letter only on the final attempt
  reportIssueBackend({
    namespace: 'EMAIL_LIFECYCLE_SEND_FAILED',
    message: deadLetterOnFailure
      ? `All email transports failed for lifecycle email (${transport})`
      : 'All email transports failed for lifecycle email (non-final attempt, retry pending)',
    payload: {
      to: params.to,
      subject: params.subject,
      error: error,
    },
    mode: deadLetterOnFailure ? 'error' : 'warn',
  });

  // Non-final attempt: the retry wrapper / outer layer owns the incident.
  // No FailedEmail row, no EMAIL_SEND_FAILED event — exactly 1 dead-letter
  // per incident is written by whoever sets deadLetterOnFailure=true.
  if (!deadLetterOnFailure) {
    return false;
  }

  // DECISION: await both writes so the audit trail is durable before the caller sees false;
  // process death between send failure and DB commit would otherwise lose the only record of
  // the failed email.
  // DECISION: writeRawEventLog_IO drops entries without created_by_user_id (loud generic
  // report, no durable record), so passing user:null is a pseudo-write. Without a system actor
  // we report loudly and skip (pattern: domain/email/operations/admin-alerts.operation.ts daily
  // digest). The FailedEmail dead-letter row below is still written regardless.
  const systemActorId = await resolveSystemActorId_IO();
  if (systemActorId) {
    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_SEND_FAILED,
      user: { id: systemActorId },
      responseBody: {
        to: params.to,
        subject: params.subject,
        reason: `All email transports failed (${transport})`,
      },
    }).catch(auditError => {
      reportIssueBackend({
        namespace: 'EMAIL_LIFECYCLE_AUDIT_FAILED',
        message: 'Failed to record lifecycle audit event',
        payload: { to: params.to, error: auditError },
        mode: 'error',
      });
    });
  } else {
    reportIssueBackend({
      namespace: 'EMAIL_LIFECYCLE_AUDIT_SKIPPED',
      message:
        'EMAIL_SEND_FAILED audit SKIPPED: system actor unavailable (no admin user seeded/configured) — durable EventLog entry would be dropped',
      payload: { to: params.to, subject: params.subject },
      mode: 'error',
    });
  }

  await DB_CLIENT.use.failedEmail
    .create({
      data: {
        recipient: params.to,
        template: params.templateId,
        subject: params.subject,
        payload: {
          tags: params.tags,
          headers: params.headers,
        },
        error: error instanceof Error ? error.message : String(error),
        // Count enabled transports, including SMTP only when credentials exist.
        attempts: attempts,
      },
    })
    .catch(deadLetterError => {
      reportIssueBackend({
        namespace: 'EMAIL_LIFECYCLE_DEAD_LETTER_FAILED',
        message: 'Failed to write lifecycle email to dead-letter table',
        payload: { to: params.to, error: deadLetterError },
        mode: 'error',
      });
    });

  return false;
}
