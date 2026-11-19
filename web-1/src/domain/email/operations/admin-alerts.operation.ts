/**
 * Admin Email Alerts
 *
 * Daily signup digest + churn alert.
 * Uses sendCriticalBusinessAlert() for delivery (already exists).
 * Dedup via EventLog — max 1 signup digest per day.
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { sendCriticalBusinessAlert } from '@app/email-handler/email.operations';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { resolveSystemActorId_IO } from '@app/event-log/system-actor';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { ROUTES_FRONT_APP } from '@kernel/domain/routing/routing.config';
import {
  adminUserHref,
  adminUsersWithoutRoleHref,
} from '@kernel/domain/admin/admin-users-url.config';

const MS_PER_DAY = TIME.MS_PER_DAY;

/** Role the person finished onboarding as, or that they have not yet. */
export const signupOnboardingState = (
  user:
    | {
        stylist_account: unknown;
        client_account: unknown;
      }
    | null
    | undefined
): 'stylist' | 'client' | 'stylist + client' | 'not finished' | 'unknown' => {
  if (!user) {
    return 'unknown';
  }
  const stylist = user.stylist_account !== null;
  const client = user.client_account !== null;
  if (stylist && client) {
    return 'stylist + client';
  }
  if (stylist) {
    return 'stylist';
  }
  return client ? 'client' : 'not finished';
};

/** Link from an alert mail to the person's card in the admin users list. */
const adminUserLink = (
  email: string,
  userId: string | undefined
): { label: string; url: string } => ({
  label: 'Otwórz kartę w panelu',
  url: `${buildFrontendBaseUrl()}${adminUserHref({ search: userId ?? email, userId })}`,
});

const ONBOARDING_LABEL: Record<
  ReturnType<typeof signupOnboardingState>,
  string
> = {
  stylist: 'stylistka',
  client: 'klientka',
  'stylist + client': 'stylistka i klientka',
  'not finished': 'onboarding nieukończony',
  unknown: 'brak danych',
};

const WARSAW_TIME = new Intl.DateTimeFormat('pl-PL', {
  timeZone: 'Europe/Warsaw',
  day: '2-digit',
  month: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

/**
 * One readable line per signup for the owner's digest, people who did not
 * finish onboarding first (they are the ones worth a message the same day).
 */
export const signupDigestLines = (
  signups: readonly {
    email: string;
    createdAt: string;
    onboarding: ReturnType<typeof signupOnboardingState>;
  }[]
): string[] =>
  [...signups]
    .sort(
      (a, b) =>
        Number(b.onboarding === 'not finished') -
        Number(a.onboarding === 'not finished')
    )
    .map(
      signup =>
        `${signup.email} (${ONBOARDING_LABEL[signup.onboarding]}), ${WARSAW_TIME.format(new Date(signup.createdAt))}`
    );

/**
 * Send daily signup digest to admin.
 *
 * Queries EventLog for USER_REGISTERED events in the last 24h and says, per
 * person, whether onboarding was finished and as which role.
 * Dedup: checks if EMAIL_ADMIN_SIGNUP_DIGEST_SENT already exists for today.
 *
 * A signup is USER_REGISTERED (Better Auth user.create hook); ACCOUNT_CREATED is never written.
 * The onboarding column is the point: someone who registered and never picked a role is worth a
 * personal message the same day.
 */
export const sendDailySignupDigest_IO = async (): Promise<void> => {
  // Sweep contract: returns void, errors are logged + swallowed.
  // Caller (cron / runner) treats this as fire-and-forget. Re-throwing would
  // crash the sweep and skip other operations.
  try {
    const now = new Date();
    const oneDayAgo = new Date(now.getTime() - MS_PER_DAY);

    // Dedup: check if digest already sent today
    const existingDigest = await DB_CLIENT.use.eventLog.findFirst({
      where: {
        event: APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_SIGNUP_DIGEST_SENT,
        event_type: EventLogTypeValue.EMAIL,
        created_at: { gte: oneDayAgo },
      },
      select: { event_log_id: true },
    });

    if (existingDigest) {
      return;
    } // Already sent today

    // DECISION: resolve the system actor BEFORE sending. writeRawEventLog_IO silently drops the
    // EMAIL_ADMIN_SIGNUP_DIGEST_SENT sentinel without created_by_user_id, so sending anyway would
    // defeat the dedup and re-send the digest on every sweep. Report loudly and skip instead.
    const systemActorId = await resolveSystemActorId_IO();
    if (!systemActorId) {
      reportIssueBackend({
        namespace: 'DAILY_SIGNUP_DIGEST_ERROR',
        message:
          'Signup digest SKIPPED: system actor unavailable (no admin user seeded/configured) — EventLog dedup sentinel cannot be persisted',
        payload: {},
        mode: 'error',
      });
      return;
    }

    // Query new signups in the last 24h
    const recentSignups = await DB_CLIENT.use.eventLog.findMany({
      where: {
        event: APP_EVENTS.INFO.USER.USER_REGISTERED,
        event_type: EventLogTypeValue.ACCOUNT,
        created_at: { gte: oneDayAgo },
      },
      select: {
        created_by_user_id: true,
        created_at: true,
        event_payload: true,
      },
      orderBy: { created_at: 'desc' },
      take: 100, // Safety cap
    });

    if (recentSignups.length === 0) {
      return;
    } // No new signups — skip

    // Fetch basic user info for the digest
    const userIds = recentSignups
      .map(s => s.created_by_user_id)
      .filter((id): id is string => Boolean(id));
    const users = await DB_CLIENT.use.user.findMany({
      where: { id: { in: userIds } },
      select: {
        id: true,
        email: true,
        name: true,
        stylist_account: { select: { account_id: true } },
        client_account: { select: { client_account_id: true } },
      },
      // orderby-exempt: users.id is a primary key; at most 100 signup rows feed this 200-row lookup (admin digest test).
      take: 200,
    });
    const userMap = new Map(users.map(u => [u.id, u]));

    const signupDetails = recentSignups.map(s => {
      const user = s.created_by_user_id
        ? userMap.get(s.created_by_user_id)
        : null;
      return {
        email: user?.email ?? 'unknown',
        name: user?.name ?? '',
        createdAt: s.created_at.toISOString(),
        onboarding: signupOnboardingState(user),
      };
    });
    const unfinished = signupDetails.filter(
      detail => detail.onboarding === 'not finished'
    ).length;

    const sent = await sendCriticalBusinessAlert({
      alertTitle: 'Nowe rejestracje z ostatniej doby',
      alertMessage: `Rejestracje: ${recentSignups.length}, w tym bez dokończonego onboardingu: ${unfinished}.`,
      lines: signupDigestLines(signupDetails),
      link:
        unfinished > 0
          ? {
              label: 'Otwórz osoby bez dokończonego onboardingu',
              url: `${buildFrontendBaseUrl()}${adminUsersWithoutRoleHref()}`,
            }
          : {
              label: 'Otwórz listę użytkowników',
              url: `${buildFrontendBaseUrl()}${ROUTES_FRONT_APP.ADMIN_USERS}`,
            },
      details: {
        count: recentSignups.length,
        signups: signupDetails,
        period: `${oneDayAgo.toISOString()} — ${now.toISOString()}`,
      },
    });

    if (!sent) {
      return;
    }

    // DECISION: digest dedup is best-effort check-then-act, not atomic: two overlapping sweeps
    // (e.g. on separate instances) can both miss the sentinel and send twice. Accepted: a rare
    // duplicate to one admin is cheaper than an atomic claim. Send-before-record is deliberate:
    // recording first would let a failed send suppress the digest for a whole day. If duplicates
    // start to matter, add a pg advisory lock around the section; do not reverse the order.
    await recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_SIGNUP_DIGEST_SENT,
      user: { id: systemActorId },
      responseBody: {
        count: recentSignups.length,
        period: `${oneDayAgo.toISOString()} — ${now.toISOString()}`,
      },
    });
  } catch (error) {
    reportIssueBackend({
      namespace: 'DAILY_SIGNUP_DIGEST_ERROR',
      message: `sendDailySignupDigest_IO failed: ${error instanceof Error ? error.message : String(error)}`,
      payload:
        error instanceof Error
          ? { message: error.message, stack: error.stack }
          : { error: String(error) },
      mode: 'error',
    });
  }
};

/**
 * Send churn alert to admin when a customer cancels.
 *
 * Triggered from subscription webhook handler when cancel_at_period_end changes to true.
 * Fire-and-forget is OK for admin alerts (logging, not critical path).
 */
export const sendChurnAlert_IO = async ({
  accountId,
  email,
  plan,
  userId,
}: {
  accountId: string;
  email: string;
  plan: string;
  userId?: string;
}): Promise<void> => {
  try {
    const sent = await sendCriticalBusinessAlert({
      alertTitle: 'Stylistka anulowała subskrypcję',
      link: adminUserLink(email, userId),
      alertMessage:
        'Anulowanie jest zaplanowane. Plan działa do końca opłaconego okresu, potem konto przejdzie na Free Demo.',
      details: {
        accountId,
        email,
        plan,
        canceledAt: new Date().toISOString(),
      },
    });

    if (!sent) {
      return;
    }

    void recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_CHURN_ALERT_SENT,
      user: userId ? { id: userId } : { email },
      responseBody: {
        accountId,
        plan,
      },
    }).catch(() => undefined);
  } catch (error) {
    reportIssueBackend({
      namespace: 'CHURN_ALERT_ERROR',
      message: `Failed to send churn alert for account ${accountId}`,
      payload: error,
      mode: 'error',
    });
  }
};

/**
 * Admin alert when a stylist lowers her plan (owner): "może lecieć zawsze póki co, bez innych warunków, tylko downgrade".
 * Covers paid-to-paid proration (customer.subscription.updated) and paid-to-FREE
 * cancellation (customer.subscription.deleted). Separate from the churn alert,
 * which fires when cancel_at_period_end is scheduled and the plan is still active.
 * Fire-and-forget admin visibility. Never throws (same as sendChurnAlert_IO).
 */
export const sendDowngradeAlert_IO = async ({
  accountId,
  email,
  oldPlan,
  newPlan,
  userId,
}: {
  accountId: string;
  email: string;
  oldPlan: string;
  newPlan: string;
  userId?: string;
}): Promise<void> => {
  try {
    const sent = await sendCriticalBusinessAlert({
      alertTitle: 'Stylistka obniżyła plan',
      link: adminUserLink(email, userId),
      alertMessage: `Plan zmieniony z ${oldPlan} na ${newPlan}.`,
      details: {
        accountId,
        email,
        oldPlan,
        newPlan,
        downgradedAt: new Date().toISOString(),
      },
    });

    if (!sent) {
      return;
    }

    void recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_DOWNGRADE_ALERT_SENT,
      user: userId ? { id: userId } : { email },
      responseBody: {
        accountId,
        oldPlan,
        newPlan,
      },
    }).catch(() => undefined);
  } catch (error) {
    reportIssueBackend({
      namespace: 'DOWNGRADE_ALERT_ERROR',
      message: `Failed to send downgrade alert for account ${accountId}`,
      payload: error,
      mode: 'error',
    });
  }
};
