/**
 * Onboarding Abandonment Recovery Operation
 *
 * Sweep step: find users who registered 24-48h ago and still have no StylistAccount
 * (onboarding never completed). Sends a single re-engagement email.
 *
 * Idempotency: EventLog EMAIL_ONBOARDING_INCOMPLETE_24H_SENT dedup.
 * Category: TRIAL_SEQUENCE — marketing-tier, respects opt-out preferences.
 * One email per user lifetime (not per renewal period).
 */

import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { TIME } from '@kernel/application/constants.config';
import {
  ONBOARDING_ABANDONMENT_RULE,
  EMAIL_CATEGORY,
  EMAIL_LIFECYCLE_CONFIG,
} from '@kernel/domain/email/email-schedule.config';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getLocaleOrDefault } from '@kernel/domain/i18n/i18n.config';
import { renderEmailTemplate } from '@app/email-handler/email-template.renderer';
import { sendLifecycleEmail } from '@app/email-handler/email-transport';
import { withEmailDeliveryRetry } from '@app/email-handler/email-retry.utils';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import { runWithConcurrency } from '@app/utils/concurrency.utils';
import {
  batchGetEmailFrequencyCounts_IO,
  canSendEmailFromCache,
} from '@app/email-handler/lifecycle/email-frequency.guard';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';

const MS_PER_HOUR = TIME.MS_PER_HOUR;

/**
 * Users in the 24-48 h window after signup who finished no onboarding.
 * Shared by the sweep and the admin queue preview (email-pipeline.query.ts),
 * which evaluates it at "now" and at "now + 24 h".
 */
export const queryOnboardingAbandonmentCandidates = (now: Date) => {
  const minAge = new Date(
    now.getTime() - ONBOARDING_ABANDONMENT_RULE.triggerAfterHours * MS_PER_HOUR
  );
  const maxAge = new Date(
    now.getTime() -
      (ONBOARDING_ABANDONMENT_RULE.triggerAfterHours +
        ONBOARDING_ABANDONMENT_RULE.triggerWindowHours) *
        MS_PER_HOUR
  );

  // 1. Find users who registered in the 24-48h window
  //    and completed NO onboarding of either type (never picked a role).
  //    User.createdAt is the Prisma field name (mapped from DB created_at).
  return DB_CLIENT.use.user.findMany({
    where: {
      is_active: true,
      createdAt: {
        gte: maxAge, // older bound: must be at most 48h old
        lte: minAge, // newer bound: must be at least 24h old
      },
      // DECISION (nie usuwaj tego komentarza):
      // Predykat = "onboarding NIGDY nieukończony", więc MUSI wykluczać OBIE ścieżki.
      // Sam stylist_account:null łapał też userów, którzy ukończyli onboarding KLIENTKI
      // (onboardAsClient_IO tworzy client_account, NIE stylist_account; User.account_type
      // default = CLIENT) — dostawali stylistowy nudge "dokończ portfolio" mimo świadomego
      // wyboru roli klienta (wrong-audience). Siostrzany winback-deletion celowo pomija
      // klientki (ClientAccount nie ma marketing-preference); tu domykamy tę samą intencję.
      stylist_account: null,
      client_account: null,
    },
    select: {
      id: true,
      email: true,
      name: true,
      createdAt: true,
    },
    // DECISION (nie usuwaj tego komentarza):
    // orderBy createdAt asc + SSOT cap (MAX_EMAILS_PER_SWEEP, nie literał 50) + cap-hit warn
    // — parytet z winback-deletion (I3) i renewal-reminder. Bez orderBy LIMIT zwraca
    // niedeterministyczny podzbiór, więc przy >cap porzuceń w oknie 24-48h ci od pozycji
    // cap+1 nigdy nie dostają nudge'a (okno 24h + lifetime-dedup = utrata na zawsze). asc =
    // najstarsi (najbliżej wyjścia z okna 24-48h) pierwsi, nigdy nie oni są dropowani.
    orderBy: { createdAt: 'asc' },
    take: EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP, // Safety cap per sweep
  });
};

/** Users from `userIds` who already got the reminder (lifetime dedup). */
export const fetchOnboardingAbandonmentSent = async (
  userIds: readonly string[]
): Promise<Set<string>> => {
  if (userIds.length === 0) {
    return new Set();
  }
  const alreadySentLogs = await DB_CLIENT.use.eventLog.findMany({
    where: {
      event: APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT,
      event_type: EventLogTypeValue.EMAIL,
      created_by_user_id: { in: [...userIds] },
    },
    select: { created_by_user_id: true },
    take: userIds.length,
  });
  return new Set(alreadySentLogs.map(l => l.created_by_user_id));
};

/**
 * Send onboarding abandonment recovery emails.
 *
 * Triggered from email lifecycle sweep (safeStep).
 * Returns number of emails sent.
 */
export const sendOnboardingAbandonmentEmails_IO = async (): Promise<number> => {
  try {
    const candidates = await queryOnboardingAbandonmentCandidates(new Date());

    if (candidates.length === 0) {
      return 0;
    }

    if (candidates.length === EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP) {
      reportIssueBackend({
        namespace: 'ONBOARDING_ABANDONMENT_SWEEP_CAP_HIT',
        message: `Onboarding-abandonment sweep hit the per-sweep cap (${EMAIL_LIFECYCLE_CONFIG.MAX_EMAILS_PER_SWEEP}); abandoners beyond the cap in the 24-48h window are deferred and may fall out of the window before the next sweep`,
        payload: {},
        mode: 'warn',
      });
    }

    const userIds = candidates.map(u => u.id);

    // 2. Batch dedup: check who already received this email (lifetime dedup)
    const alreadySent = await fetchOnboardingAbandonmentSent(userIds);

    // 3. Batch-resolve locale via the canonical SSOT helper (eliminates the
    //    re-implemented distinct-no-take block; same query the inline version mirrored).
    //    Helper is fail-open (locale-query error → empty map → all users default 'pl')
    //    so a locale lookup hiccup cannot abort the whole abandonment sweep.
    const localeMap = await batchResolveLocales(userIds);

    // 4. Batch-resolve frequency counts
    const frequencyCountMap = await batchGetEmailFrequencyCounts_IO(userIds);

    // 5. Process with bounded concurrency
    const results = await runWithConcurrency(candidates, 5, async user => {
      try {
        // Dedup: skip if already sent
        if (alreadySent.has(user.id)) {
          return 0;
        }

        // Frequency cap — TRIAL_SEQUENCE is NOT exempt
        const emailCount = frequencyCountMap.get(user.id) ?? 0;
        if (!canSendEmailFromCache(emailCount, EMAIL_CATEGORY.TRIAL_SEQUENCE)) {
          return 0;
        }

        const locale = getLocaleOrDefault(localeMap.get(user.id) ?? 'pl');
        const displayName = user.name || '';
        const unsubscribeUrl = buildEmailUnsubscribeUrl(
          user.id,
          EMAIL_CATEGORY.TRIAL_SEQUENCE,
          locale
        );
        const appBaseUrl = buildFrontendBaseUrl();

        const vars: Record<string, string> = {
          displayName,
          appUrl: appBaseUrl,
        };

        const rendered = renderEmailTemplate(
          ONBOARDING_ABANDONMENT_RULE.bodyTemplateId,
          vars,
          locale,
          unsubscribeUrl,
          ONBOARDING_ABANDONMENT_RULE.subjectKey
        );

        const sent = await withEmailDeliveryRetry(isFinalAttempt =>
          sendLifecycleEmail({
            to: user.email,
            subject: rendered.subject,
            html: rendered.html,
            text: rendered.text,
            templateId: ONBOARDING_ABANDONMENT_RULE.bodyTemplateId,
            category: ONBOARDING_ABANDONMENT_RULE.category,
            // Dead-letter exactly once per incident (final retry attempt only)
            deadLetterOnFailure: isFinalAttempt,
            tags: [
              'lifecycle',
              ONBOARDING_ABANDONMENT_RULE.id.toLowerCase(),
              ONBOARDING_ABANDONMENT_RULE.category.toLowerCase(),
            ],
            headers: {
              'List-Unsubscribe': `<${unsubscribeUrl}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
          })
        );

        if (sent) {
          // DECISION (nie usuwaj tego komentarza): AWAIT zapisu dedup (parytet z
          // winback-deletion.operation:250-267 i admin-alerts.operation). Okno dopasowania
          // (triggerAfterHours 24h + triggerWindowHours 24h) jest SZERSZE niż throttle sweepu
          // (SWEEP_THROTTLE_MS 6h), więc ten sam user pasuje do ~4 kolejnych sweepów. Gdyby
          // worker wrócił PRZED commitem wiersza dedup (fire-and-forget), sweep N+1 odczytałby
          // EventLog bez tego wpisu → DRUGI e-mail re-engagement (ta sama klasa wyścigu, którą
          // rodzeństwo zamyka awaitem). recordAuditEvent_IO nie rzuca (połyka błąd, zwraca
          // undefined); try-catch = defense-in-depth, a po błędzie liczymy jako wysłane
          // (return 1) — resend gorszy niż brakujący wiersz audytu.
          try {
            await recordAuditEvent_IO({
              eventName:
                APP_EVENTS.INFO.EMAIL.EMAIL_ONBOARDING_INCOMPLETE_24H_SENT,
              user: { id: user.id },
              responseBody: {
                templateId: ONBOARDING_ABANDONMENT_RULE.bodyTemplateId,
                category: ONBOARDING_ABANDONMENT_RULE.category,
              },
            });
          } catch (auditErr) {
            reportIssueBackend({
              namespace: 'ONBOARDING_ABANDONMENT_DEDUP_WRITE_ERROR',
              message: `Onboarding abandonment email sent but dedup audit write threw for user ${user.id} — counted as sent to avoid resend`,
              payload: auditErr,
              mode: 'error',
            });
          }
          return 1;
        }
        return 0;
      } catch (err) {
        reportIssueBackend({
          namespace: 'ONBOARDING_ABANDONMENT_EMAIL_ERROR',
          message: `Failed to send onboarding abandonment email for user ${user.id}`,
          payload: err,
          mode: 'error',
        });
        return 0;
      }
    });

    return results.reduce<number>((sum, n) => sum + n, 0);
  } catch (error) {
    reportIssueBackend({
      namespace: 'ONBOARDING_ABANDONMENT_SWEEP_ERROR',
      message: 'sendOnboardingAbandonmentEmails_IO failed',
      payload: error,
      mode: 'error',
    });
    return 0;
  }
};
