import { recordLifecycleDecision_IO } from '@app/email-handler/lifecycle/operational-decision';
import { recordAuditEvent_IO } from '@app/event-log/event-log-io.wrapper';
import { DB_CLIENT } from '@app/db/db.client';
import { buildFrontendBaseUrl } from '@app/environment/environment.utils.api';
import {
  renderEmailTemplate,
  EMAIL_LIFECYCLE_CTA_IDS,
} from '@app/email-handler/email-template.renderer';
import { buildEmailUnsubscribeUrl } from '@app/email-handler/email-unsubscribe.url';
import { sendMeasuredLifecycleEmail } from '@app/email-handler/lifecycle/measured-transport';
import { batchResolveLocales } from '@app/email-handler/lifecycle/email-locale-batch.resolver';
import {
  FREE_EMAIL_CONFIG,
  FREE_EMAIL_RULES,
} from '@kernel/domain/email/email-free.config';
import { reportIssueBackend } from '@app/debugger/error-handler';
import {
  loadFreeEmailAudience_IO,
  freeFrequencyPreview_IO,
} from './free-email.audience';
import {
  resolveFreeEmail,
  type FreeEnrollmentView,
} from './free-email.resolver';
import {
  initializeFreeEmailCampaign_IO,
  finishFreeEnrollment_IO,
} from './free-email.enrollment';

/** Includes skipped/finished candidates, so preview explains the real decision. */
export const previewFreeEnrollment_IO = async (
  enrollment: FreeEnrollmentView,
  now = new Date()
) => {
  const [audience, messages] = await Promise.all([
    loadFreeEmailAudience_IO(enrollment.accountId, now),
    DB_CLIENT.use.emailLifecycleMessage.findMany({
      where: { accountId: enrollment.accountId, occurrence: enrollment.id },
      select: { ruleId: true, opportunityId: true, createdAt: true },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
      take: 20,
    }),
  ]);
  if (!audience) {
    return {
      enrollment,
      audience: null,
      plannedTemplateId: null,
      plannedOpportunityId: null,
      decision: { kind: 'finish' as const, reason: 'account_missing' },
    };
  }
  const history = messages.map(row => ({
    templateId: row.ruleId,
    opportunityId: row.opportunityId ?? '',
    at: row.createdAt,
  }));
  let decision = resolveFreeEmail(enrollment, audience.state, history, now);
  const plannedTemplateId =
    decision.kind === 'send' ? decision.templateId : null;
  const plannedOpportunityId =
    decision.kind === 'send' ? decision.opportunityId : null;
  if (decision.kind === 'send') {
    const suppression = await freeFrequencyPreview_IO(
      audience.account.created_by_user_id,
      now
    );
    if (suppression) {
      decision = {
        kind: 'skip',
        reason: suppression,
        plannedAt: decision.plannedAt,
      };
    }
  }
  return {
    enrollment,
    audience,
    decision,
    plannedTemplateId,
    plannedOpportunityId,
  };
};

export const getFreeEmailPreview_IO = async (now = new Date()) => {
  const campaign = await DB_CLIENT.use.emailLifecycleCampaign.findUnique({
    where: { id: FREE_EMAIL_CONFIG.CAMPAIGN_ID },
  });
  const enrollments = await DB_CLIENT.use.freeEmailEnrollment.findMany({
    where: { status: 'active' },
    orderBy: [{ startedAt: 'asc' }, { id: 'asc' }],
    take: 100,
  });
  const candidates = [];
  for (const enrollment of enrollments) {
    candidates.push(await previewFreeEnrollment_IO(enrollment, now));
  }
  return { campaign, candidates };
};

export const sendFreeEmails_IO = async (
  sweepId?: string
): Promise<{ emailsSent: number; accountsProcessed: number }> => {
  const now = new Date();
  const campaign = await initializeFreeEmailCampaign_IO(now);
  if (campaign.mode !== 'ON') {
    return { emailsSent: 0, accountsProcessed: 0 };
  }
  let emailsSent = 0;
  let accountsProcessed = 0;
  let cursor: string | undefined;
  for (let page = 0; page < 20 && emailsSent < 50; page += 1) {
    const enrollments = await DB_CLIENT.use.freeEmailEnrollment.findMany({
      where: { status: 'active' },
      orderBy: { id: 'asc' },
      take: 100,
      ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    });
    if (enrollments.length === 0) {
      break;
    }
    const locales = await batchResolveLocales(
      enrollments.map(row => row.userId)
    );
    for (const enrollment of enrollments) {
      accountsProcessed += 1;
      const preview = await previewFreeEnrollment_IO(enrollment, now);
      if (preview.decision.kind !== 'send') {
        await recordLifecycleDecision_IO({
          identity: enrollment.id,
          kind: preview.decision.kind === 'finish' ? 'finished' : 'suppressed',
          reason: preview.decision.reason,
          family: 'free',
          templateId: preview.plannedTemplateId ?? 'none',
          ruleId: preview.plannedTemplateId ?? 'none',
          locale: locales.get(enrollment.userId) ?? 'pl',
          cohort: enrollment.cohort,
          ...(preview.plannedOpportunityId
            ? { opportunityId: preview.plannedOpportunityId }
            : {}),
          ...(preview.decision.kind === 'skip' && preview.decision.plannedAt
            ? { plannedAt: preview.decision.plannedAt }
            : {}),
          now,
        });
      }
      if (preview.decision.kind === 'finish') {
        await finishFreeEnrollment_IO(
          enrollment.id,
          preview.decision.reason,
          now
        );
        continue;
      }
      if (preview.decision.kind !== 'send' || !preview.audience) {
        continue;
      }
      const decision = preview.decision;
      const account = preview.audience.account;
      const locale = locales.get(enrollment.userId) ?? 'pl';
      const unsubscribe = buildEmailUnsubscribeUrl(
        enrollment.userId,
        'TRIAL_SEQUENCE',
        locale
      );
      const result = await sendMeasuredLifecycleEmail({
        userId: enrollment.userId,
        accountId: enrollment.accountId,
        family: 'free',
        ruleId: decision.templateId,
        templateId: decision.templateId,
        occurrence: enrollment.id,
        opportunityId: decision.opportunityId,
        contentVersion: FREE_EMAIL_CONFIG.CONTENT_VERSION,
        locale,
        cohort: enrollment.cohort,
        ctaIds: [...EMAIL_LIFECYCLE_CTA_IDS],
        scheduledAt: decision.plannedAt,
        recipientEmail: account.created_by_user.email,
        ...(sweepId ? { sweepId } : {}),
        validate: async () => {
          const [fresh, freshCampaign, active] = await Promise.all([
            loadFreeEmailAudience_IO(enrollment.accountId, new Date()),
            DB_CLIENT.use.emailLifecycleCampaign.findUnique({
              where: { id: campaign.id },
            }),
            DB_CLIENT.use.freeEmailEnrollment.findUnique({
              where: { id: enrollment.id },
            }),
          ]);
          if (
            !fresh ||
            freshCampaign?.mode !== 'ON' ||
            active?.status !== 'active' ||
            fresh.account.created_by_user.email !==
              account.created_by_user.email
          ) {
            return false;
          }
          const current = resolveFreeEmail(active, fresh.state, [], new Date());
          return (
            current.kind === 'send' &&
            current.templateId === decision.templateId &&
            current.opportunityId === decision.opportunityId &&
            current.pendingRequest === decision.pendingRequest
          );
        },
        render: messageId => {
          const rendered = renderEmailTemplate(
            decision.templateId,
            {
              appUrl: buildFrontendBaseUrl(),
              displayName: account.display_name ?? '',
              lifecycleMessageId: messageId,
              pendingRequest: decision.pendingRequest ? '1' : '0',
            },
            locale,
            unsubscribe,
            decision.subjectKey
          );
          return {
            to: account.created_by_user.email,
            ...rendered,
            headers: {
              'List-Unsubscribe': `<${unsubscribe}>`,
              'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
            },
            disableClickTracking: true,
          };
        },
      });
      if (result.status === 'accepted') {
        await recordAuditEvent_IO({
          eventName: FREE_EMAIL_RULES[decision.templateId].infoEvent,
          user: { id: enrollment.userId },
          responseBody: {
            lifecycleMessageId: result.messageId,
            templateId: decision.templateId,
          },
        });
        emailsSent += 1;
        if (enrollment.cohort === 'existing') {
          await finishFreeEnrollment_IO(enrollment.id, 'sent');
        }
      }
      if (emailsSent >= 50) {
        break;
      }
    }
    cursor = enrollments.at(-1)?.id;
    if (enrollments.length < 100) {
      break;
    }
  }
  if (accountsProcessed >= 2000) {
    reportIssueBackend({
      namespace: 'FREE_EMAIL_SWEEP_CAP',
      message: 'Free email sweep reached its scan limit',
      payload: { accountsProcessed, emailsSent },
      mode: 'warn',
    });
  }
  return { emailsSent, accountsProcessed };
};
