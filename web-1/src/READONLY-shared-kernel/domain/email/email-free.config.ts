/** Durable sequence identity and timing shared by delivery, preview and analytics. */
export const FREE_EMAIL_CONFIG = Object.freeze({
  CAMPAIGN_ID: 'free-onboarding-v1',
  VERSION: '1',
  CONTENT_VERSION: '1',
  OPPORTUNITIES: [
    { id: 'd1', day: 1 },
    { id: 'd4', day: 4 },
    { id: 'd9', day: 9 },
  ],
  WINDOW_HOURS: 48,
  MIN_GAP_HOURS: 48,
  NEW_EXPIRY_DAYS: 11,
  EXISTING_SPREAD_DAYS: 7,
  EXISTING_EXPIRY_DAYS: 14,
} as const);

export type FreeEmailMode = 'OFF' | 'PREVIEW' | 'ON';
export type FreeEmailTemplateId =
  'free-first-photo' | 'free-public-profile' | 'free-first-client';

export const FREE_EMAIL_RULES = Object.freeze({
  'free-first-photo': {
    infoEvent: 'EMAIL_FREE_FIRST_PHOTO_SENT',
    category: 'TRIAL_SEQUENCE',
    subjectKey: 'email.free.firstPhoto.subject',
    targetAction: 'photo_published',
  },
  'free-public-profile': {
    infoEvent: 'EMAIL_FREE_PUBLIC_PROFILE_SENT',
    category: 'TRIAL_SEQUENCE',
    subjectKey: 'email.free.publicProfile.subject',
    targetAction: 'work_pinned',
  },
  'free-first-client': {
    infoEvent: 'EMAIL_FREE_FIRST_CLIENT_SENT',
    category: 'TRIAL_SEQUENCE',
    subjectKey: 'email.free.firstClient.subject',
    targetAction: 'connection_accepted',
  },
} as const);
