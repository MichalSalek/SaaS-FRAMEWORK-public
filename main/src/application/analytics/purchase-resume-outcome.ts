import { TIME } from '@kernel/application/constants.config';
type ResumeAction =
  'upload' | 'gallery' | 'connections' | 'client' | 'brand' | 'salon' | 'team';
let pending: ResumeAction | null = null;
let expiresAt = 0;

export const armPurchaseResumeOutcome = (action: ResumeAction): void => {
  pending = action;
  expiresAt = Date.now() + TIME.MS_PER_DAY;
};
export const clearPurchaseResumeOutcome = (): void => {
  pending = null;
};

/** A route opening is a resumption. Only an existing successful mutation completes the task. */
export const takePurchaseResumeOutcome = (
  flow: string,
  step: string
): ResumeAction | null => {
  if (Date.now() >= expiresAt) {
    pending = null;
    return null;
  }
  const matches =
    pending === 'upload' || pending === 'gallery'
      ? flow === 'upload' && step === 'published'
      : pending === 'connections'
        ? flow === 'pairing' &&
          ['request_sent', 'request_accepted'].includes(step)
        : pending === 'client'
          ? flow === 'client_card' &&
            ['visit_added', 'note_saved', 'important_note_saved'].includes(step)
          : pending === 'brand'
            ? flow === 'profile' && step === 'saved'
            : pending === 'salon'
              ? flow === 'salon_profile' &&
                ['saved', 'published'].includes(step)
              : pending === 'team'
                ? flow === 'salon_team' && step === 'invite_sent'
                : false;
  if (!matches) {
    return null;
  }
  const result = pending;
  pending = null;
  return result;
};
