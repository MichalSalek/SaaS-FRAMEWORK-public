import type { EmailCategory } from '@kernel/domain/email/email-schedule.config';
import type { LocaleType } from '@kernel/domain/i18n/i18n.config';
import { DB_CLIENT } from '@app/db/db.client';
import { sendMeasuredLifecycleEmail } from '@app/email-handler/lifecycle/measured-transport';
import {
  EMAIL_LIFECYCLE_CTA_IDS,
  renderEmailTemplate,
} from '@app/email-handler/email-template.renderer';

/** All measured schedules reserve before rendering and never retry an ambiguous send. */
export const sendScheduledLifecycleEmail = async (input: {
  userId: string;
  accountId: string;
  email: string;
  family: string;
  ruleId: string;
  occurrence: string;
  templateId: string;
  subjectKey: string;
  locale: LocaleType;
  category: EmailCategory;
  vars: Record<string, string>;
  unsubscribeUrl: string;
  sweepId?: string;
  allowDeleted?: boolean;
  validate?: () => Promise<boolean>;
}) =>
  sendMeasuredLifecycleEmail({
    userId: input.userId,
    accountId: input.accountId,
    recipientEmail: input.email,
    family: input.family,
    ruleId: input.ruleId,
    templateId: input.templateId,
    occurrence: input.occurrence,
    contentVersion: '1',
    locale: input.locale,
    cohort: 'existing',
    ctaIds: [...EMAIL_LIFECYCLE_CTA_IDS],
    category: input.category,
    scheduledAt: new Date(),
    ...(input.sweepId ? { sweepId: input.sweepId } : {}),
    validate: async () => {
      const user = await DB_CLIENT.use.user.findUnique({
        where: { id: input.userId },
        select: {
          is_active: true,
          deleted_at: true,
          disabled_at: true,
          email: true,
          stylist_account: {
            select: { email_trial_sequence: true, email_marketing: true },
          },
        },
      });
      if (!user || user.disabled_at || user.email !== input.email) {
        return false;
      }
      if (!input.allowDeleted && (!user.is_active || user.deleted_at)) {
        return false;
      }
      if (
        input.category === 'TRIAL_SEQUENCE' &&
        user.stylist_account?.email_trial_sequence === false
      ) {
        return false;
      }
      if (
        input.category === 'MARKETING' &&
        user.stylist_account?.email_marketing === false
      ) {
        return false;
      }
      return input.validate ? input.validate() : true;
    },
    render: messageId => ({
      to: input.email,
      ...renderEmailTemplate(
        input.templateId,
        { ...input.vars, lifecycleMessageId: messageId },
        input.locale,
        input.unsubscribeUrl,
        input.subjectKey
      ),
      headers: input.unsubscribeUrl
        ? {
            'List-Unsubscribe': `<${input.unsubscribeUrl}>`,
            'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
          }
        : {},
    }),
  });
