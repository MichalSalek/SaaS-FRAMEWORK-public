import {
  FREE_EMAIL_CONFIG,
  FREE_EMAIL_RULES,
  type FreeEmailTemplateId,
} from '@kernel/domain/email/email-free.config';
import { TIME } from '@kernel/application/constants.config';

export type FreeEmailState = {
  active: boolean;
  effectiveFree: boolean;
  hasTrialHistory: boolean;
  hasPaidHistory: boolean;
  checkoutActive: boolean;
  tipsEnabled: boolean;
  deliveryBlocked: boolean;
  excluded: boolean;
  visiblePhotoCount: number;
  visiblePinnedCount: number;
  acceptedPairCount: number;
  pendingPairCount: number;
};
export type FreeEnrollmentView = {
  id: string;
  userId?: string;
  accountId: string;
  cohort: string;
  startedAt: Date;
  status: string;
};
export type FreeEmailHistory = {
  templateId: string;
  opportunityId: string;
  at: Date;
};
export type FreeEmailDecision =
  | { kind: 'finish'; reason: string }
  | { kind: 'skip'; reason: string; plannedAt?: Date }
  | {
      kind: 'send';
      opportunityId: string;
      templateId: FreeEmailTemplateId;
      subjectKey: string;
      pendingRequest: boolean;
      plannedAt: Date;
      expiresAt: Date;
    };

/** Stable day assignment does not move when the process or deployment restarts. */
export const freeExistingOffsetDays = (accountId: string): number => {
  let hash = 2166136261;
  for (const character of accountId) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  return hash % FREE_EMAIL_CONFIG.EXISTING_SPREAD_DAYS;
};

/** Shared by the real sweep and the admin preview; never performs I/O. */
export const resolveFreeEmail = (
  enrollment: FreeEnrollmentView,
  state: FreeEmailState,
  history: readonly FreeEmailHistory[],
  now: Date
): FreeEmailDecision => {
  if (enrollment.status !== 'active') {
    return { kind: 'skip', reason: 'closed' };
  }
  if (!state.active) {
    return { kind: 'finish', reason: 'inactive' };
  }
  if (state.excluded) {
    return { kind: 'finish', reason: 'excluded' };
  }
  if (!state.tipsEnabled) {
    return { kind: 'finish', reason: 'unsubscribed' };
  }
  if (state.deliveryBlocked) {
    return { kind: 'finish', reason: 'delivery_blocked' };
  }
  if (!state.effectiveFree || state.hasTrialHistory || state.hasPaidHistory) {
    return { kind: 'finish', reason: 'access_changed' };
  }
  if (state.acceptedPairCount > 0) {
    return { kind: 'finish', reason: 'completed' };
  }
  const existing = enrollment.cohort === 'existing';
  const opportunities = existing
    ? [{ id: 'existing', day: freeExistingOffsetDays(enrollment.accountId) }]
    : FREE_EMAIL_CONFIG.OPPORTUNITIES;
  const expiry = new Date(
    enrollment.startedAt.getTime() +
      (existing
        ? FREE_EMAIL_CONFIG.EXISTING_EXPIRY_DAYS
        : FREE_EMAIL_CONFIG.NEW_EXPIRY_DAYS) *
        TIME.MS_PER_DAY
  );
  if (now.getTime() >= expiry.getTime()) {
    return { kind: 'finish', reason: 'expired' };
  }
  if (existing && history.length > 0) {
    return { kind: 'finish', reason: 'sent' };
  }
  const opportunity = opportunities.find(item => {
    const plannedAt =
      enrollment.startedAt.getTime() + item.day * TIME.MS_PER_DAY;
    const expiresAt = existing
      ? expiry.getTime()
      : plannedAt + FREE_EMAIL_CONFIG.WINDOW_HOURS * TIME.MS_PER_HOUR;
    return (
      now.getTime() >= plannedAt &&
      now.getTime() < expiresAt &&
      !history.some(sent => sent.opportunityId === item.id)
    );
  });
  if (!opportunity) {
    const next = opportunities.find(
      item =>
        enrollment.startedAt.getTime() + item.day * TIME.MS_PER_DAY >
        now.getTime()
    );
    return {
      kind: 'skip',
      reason: next ? 'not_due' : 'window_expired',
      ...(next
        ? {
            plannedAt: new Date(
              enrollment.startedAt.getTime() + next.day * TIME.MS_PER_DAY
            ),
          }
        : {}),
    };
  }
  const plannedAt = new Date(
    enrollment.startedAt.getTime() + opportunity.day * TIME.MS_PER_DAY
  );
  if (state.checkoutActive) {
    return { kind: 'skip', reason: 'checkout_active', plannedAt };
  }
  if (
    history.some(
      sent =>
        now.getTime() - sent.at.getTime() <
        FREE_EMAIL_CONFIG.MIN_GAP_HOURS * TIME.MS_PER_HOUR
    )
  ) {
    return { kind: 'skip', reason: 'minimum_gap', plannedAt };
  }
  // Do not skip an unfinished first step just because it was already mentioned.
  const templateId =
    state.visiblePhotoCount === 0
      ? 'free-first-photo'
      : state.visiblePinnedCount === 0
        ? 'free-public-profile'
        : 'free-first-client';
  if (history.some(sent => sent.templateId === templateId)) {
    return { kind: 'skip', reason: 'step_already_reminded', plannedAt };
  }
  const rule = FREE_EMAIL_RULES[templateId];

  return {
    kind: 'send',
    opportunityId: opportunity.id,
    templateId,
    subjectKey: rule.subjectKey,
    pendingRequest:
      templateId === 'free-first-client' && state.pendingPairCount > 0,
    plannedAt,
    expiresAt: existing
      ? expiry
      : new Date(
          plannedAt.getTime() +
            FREE_EMAIL_CONFIG.WINDOW_HOURS * TIME.MS_PER_HOUR
        ),
  };
};
