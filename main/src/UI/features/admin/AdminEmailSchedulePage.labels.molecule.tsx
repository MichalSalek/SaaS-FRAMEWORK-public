import { useTranslations } from 'next-intl';
import {
  EMAIL_CATEGORY,
  type EmailCategory,
} from '@kernel/domain/email/email-schedule.config';
import type { TrialEmailRule } from '@kernel/domain/email/email-schedule.types';
import { StatusPillAtom } from '../../components/StatusPill/StatusPill.atom';
import { describeAdminEvent } from './AdminAuditPage.helpers';
import { SoftBreakTextAtom } from '../../components/SoftBreakText/SoftBreakText.atom';
import styles from './AdminEmailSchedulePage.module.css';

export const CONDITION_LABEL_KEY = {
  ACTIVE: 'condition.ACTIVE',
  INACTIVE: 'condition.INACTIVE',
  ANY: 'condition.ANY',
} as const satisfies Record<TrialEmailRule['condition'], string>;

export const CATEGORY_LABEL_KEY = {
  [EMAIL_CATEGORY.TRANSACTIONAL]: 'category.TRANSACTIONAL',
  [EMAIL_CATEGORY.TRIAL_SEQUENCE]: 'category.TRIAL_SEQUENCE',
  [EMAIL_CATEGORY.MARKETING]: 'category.MARKETING',
} as const satisfies Record<EmailCategory, string>;

/** Rule id → i18n key. Keyed by id so the source framing string stays in the kernel. */
const FRAMING_LABEL_KEY = {
  TRIAL_D0_WELCOME: 'framing.reciprocity',
  TRIAL_D1_NUDGE: 'framing.commitment',
  TRIAL_D3_INACTIVE: 'framing.lossAversion',
  TRIAL_D3_ACTIVE: 'framing.endowmentNext',
  TRIAL_D7_ACTIVE: 'framing.endowmentPersonal',
  TRIAL_D7_INACTIVE: 'framing.socialProof',
  TRIAL_D14_ACTIVE: 'framing.endowmentSummary',
  TRIAL_D14_INACTIVE: 'framing.lossAversion',
  TRIAL_D23_WARNING: 'framing.lossEndowment',
  TRIAL_D29_LAST_DAY: 'framing.urgency',
  TRIAL_D30_ENDED: 'framing.downgrade',
  TRIAL_D37_WINBACK: 'framing.winback',
} as const;

export function framingLabelKey(
  ruleId: string
): (typeof FRAMING_LABEL_KEY)[keyof typeof FRAMING_LABEL_KEY] | null {
  if (Object.prototype.hasOwnProperty.call(FRAMING_LABEL_KEY, ruleId)) {
    return FRAMING_LABEL_KEY[ruleId as keyof typeof FRAMING_LABEL_KEY];
  }
  return null;
}

/* Meaning only: which condition is which status colour. The pill recipe
   lives in StatusPillAtom. */
const CONDITION_COLOR = {
  ACTIVE: 'var(--color-success)',
  INACTIVE: 'var(--color-warning)',
  ANY: 'var(--color-text-secondary)',
} as const satisfies Record<TrialEmailRule['condition'], string>;

export function ConditionBadgeMolecule({
  condition,
  label,
}: {
  condition: TrialEmailRule['condition'];
  label: string;
}) {
  return (
    <StatusPillAtom
      color={CONDITION_COLOR[condition]}
      label={label}
      showDot={false}
    />
  );
}

/* The mails this page lists, each with a human name in `admin.emailSchedule.mail`
   (three languages). The kernel catalogue has Polish log sentences for a few
   of them only, so the page names its own mails. */
const NAMED_MAIL_EVENTS = [
  'EMAIL_WELCOME_SENT',
  'EMAIL_TRIAL_D1_NUDGE_SENT',
  'EMAIL_TRIAL_D3_INACTIVE_SENT',
  'EMAIL_TRIAL_D3_ACTIVE_SENT',
  'EMAIL_TRIAL_D7_ACTIVE_SENT',
  'EMAIL_TRIAL_D7_INACTIVE_SENT',
  'EMAIL_TRIAL_D14_ACTIVE_SENT',
  'EMAIL_TRIAL_D14_INACTIVE_SENT',
  'EMAIL_TRIAL_D23_WARNING_SENT',
  'EMAIL_TRIAL_D29_LAST_DAY_SENT',
  'EMAIL_TRIAL_D30_ENDED_SENT',
  'EMAIL_TRIAL_D37_WINBACK_SENT',
  'EMAIL_CANCEL_D1_SENT',
  'EMAIL_CANCEL_D7_WINBACK_SENT',
  'EMAIL_CANCEL_D30_FINAL_SENT',
  'EMAIL_ONBOARDING_INCOMPLETE_24H_SENT',
  'EMAIL_RENEWAL_REMINDER_7D_SENT',
  'EMAIL_WINBACK_DELETION_D60_SENT',
] as const;

const isNamedMailEvent = (
  name: string
): name is (typeof NAMED_MAIL_EVENTS)[number] =>
  (NAMED_MAIL_EVENTS as readonly string[]).includes(name);

/** A mail named by its audit event: its human name first (ours, else the
 *  kernel catalogue's sentence), and always the event key as the quiet second
 *  line (the thing one greps logs by). */
export function EventLabelMolecule({ name }: { name: string }) {
  const t = useTranslations('admin.emailSchedule.mail');
  const label = isNamedMailEvent(name) ? t(name) : describeAdminEvent(name);
  return (
    <>
      {label ? <span className={styles.eventLabel}>{label}</span> : null}
      <code className={styles.eventKey} data-alone={label === null}>
        <SoftBreakTextAtom>{name}</SoftBreakTextAtom>
      </code>
    </>
  );
}
