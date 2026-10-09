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
 * DECISION (nie usuwaj tego komentarza, 2026-09-23):
 * The digest used to read ACCOUNT_CREATED, which nothing in the codebase ever
 * writes, so it could not fire even once the sweep started running. A signup
 * is USER_REGISTERED (Better Auth user.create hook). The onboarding column is
 * the point of the digest before launch: a person who registered and never
 * picked a role is the one worth a personal message the same day.
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

    // DECISION (nie usuwaj tego komentarza):
    // Resolve system actor BEFORE sending. The EMAIL_ADMIN_SIGNUP_DIGEST_SENT
    // sentinel (dedup, max 1/day) is silently dropped by writeRawEventLog_IO
    // when created_by_user_id is missing — sending anyway would defeat dedup
    // and re-send the digest on EVERY sweep. Loud report + skip instead.
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

    await sendCriticalBusinessAlert({
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

    // DECISION (nie usuwaj tego komentarza):
    // Dedup digestu jest BEST-EFFORT, nie atomowy. Guard to check-then-act (findFirst l.35
    // → send l.107 → record sentinel tutaj), więc dwa NAKŁADAJĄCE SIĘ sweepy (lazy-cron-via-
    // -traffic: dwa równoległe requesty oba przechodzą shouldRunEmailSweep, bo orchestrator
    // znaczy throttle PO runSweep) mogą oba zobaczyć brak sentinela i wysłać digest 2×. Await
    // porządkuje TYLKO zapis w obrębie JEDNEGO sweepu — NIE zamyka wyścigu międzysweepowego.
    // ŚWIADOMIE akceptowane: rzadki duplikat maila do JEDNEGO admina (nie do userów) jest tańszy
    // niż atomowy claim (advisory-lock wg wzorca pairing-cleanup/session-expiry). Kolejność
    // send-PRZED-record jest CELOWA: gdyby zapisać sentinel przed wysyłką, awaria send'a
    // zostawiłaby sentinel <24h i digest zniknąłby na całą dobę (utrata widoczności signupów =
    // gorsza niż duplikat). Gdy ruch prod wzrośnie i duplikaty zaczną przeszkadzać → pg advisory
    // lock wokół całej sekcji (spójnie z lockUserRow), NIE odwracać kolejności.
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
    await sendCriticalBusinessAlert({
      alertTitle: 'Stylistka anulowała subskrypcję',
      link: adminUserLink(email, userId),
      alertMessage:
        'Anulowanie jest zaplanowane. Plan działa do końca opłaconego okresu, potem konto przejdzie na Free.',
      details: {
        accountId,
        email,
        plan,
        canceledAt: new Date().toISOString(),
      },
    });

    void recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_CHURN_ALERT_SENT,
      user: userId ? { id: userId } : { email },
      responseBody: {
        accountId,
        email,
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
 * Send downgrade alert to admin when a stylist lowers their plan.
 *
 * Fires on ANY real plan downgrade (owner decision 2026-07-16: "może lecieć
 * zawsze póki co, bez innych warunków, tylko downgrade") — both the paid→paid
 * proration path (customer.subscription.updated) and the paid→FREE cancellation
 * path (customer.subscription.deleted). Orthogonal to the churn alert, which
 * fires on cancel_at_period_end scheduling (plan still active) — a downgrade is
 * the plan ACTUALLY lowering. Fire-and-forget: admin visibility, not critical
 * path. Never throws (parity with sendChurnAlert_IO).
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
    await sendCriticalBusinessAlert({
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

    void recordAuditEvent_IO({
      eventName: APP_EVENTS.INFO.EMAIL.EMAIL_ADMIN_DOWNGRADE_ALERT_SENT,
      user: userId ? { id: userId } : { email },
      responseBody: {
        accountId,
        email,
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
