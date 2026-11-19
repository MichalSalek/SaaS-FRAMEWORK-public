import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import type { SuccessFeedbackOwner } from '@kernel/application/http/http.client.types';
import {
  resolveOutcomeLevel,
  type OutcomeMoment,
} from './outcome-feedback.config';
const I = APP_EVENTS.INFO;
/** The same level registry assigns the visible owner and suppresses duplicate success. */
const EVENT_MOMENTS: Partial<Record<EVENT_INFO_TYPE, OutcomeMoment>> = {
  // The onboarding success scene owns this moment; the toast said the same
  // sentence on top of it (measured 2026-10-15 on the role-only onboarding).
  [I.USER.STYLIST_ACCOUNT_CREATED]: 'onboardingComplete',
  [I.USER.CLIENT_ACCOUNT_CREATED]: 'onboardingComplete',
  [I.SESSION_CONTAINER.SESSION_CONTAINER_CREATED]: 'sessionCreated',
  [I.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED]: 'sessionPhotoAdded',
  [I.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_REMOVED]: 'sessionPhotoRemoved',
  [I.SESSION_CONTAINER.SESSION_CONTAINER_SHARED]: 'sessionShared',
  [I.SESSION_CONTAINER.SESSION_CONTAINER_NOTE_UPDATED]: 'sessionNoteSaved',
  [I.GALLERY.GALLERY_RECORD_CREATED]: 'photoPublished',
  [I.GALLERY.GALLERY_RECORD_UPDATED]: 'photoEdited',
  [I.ACCOUNT.STYLIST_PROFILE_UPDATED]: 'profileBioSaved',
  [I.ACCOUNT.STYLIST_SOCIAL_LINKS_UPDATED]: 'profileBioSaved',
  [I.ACCOUNT.DASHBOARD_NOTE_SET]: 'dashboardNoteSaved',
  [I.ACCOUNT.DISPLAY_NAME_CHANGED]: 'accountNameSaved',
  [I.ACCOUNT.AVATAR_SET]: 'profilePhotoSaved',
  [I.CLIENT.CLIENT_CONTACT_UPDATED]: 'contactSaved',
  [I.CLIENT.CLIENT_CRM_NOTE_UPSERTED]: 'crmNoteSaved',
  // Same moment as the CRM note: the field's own completion line owns it.
  [I.CLIENT.CLIENT_IMPORTANT_NOTE_UPSERTED]: 'crmNoteSaved',
  [I.VISIT.VISIT_CREATED]: 'visitCreated',
  [I.VISIT.VISIT_NOTE_UPDATED]: 'visitNoteSaved',
  [I.VISIT.VISIT_RESULT_PHOTO_ADDED]: 'visitResultAdded',
  [I.USER.USER_NAME_CHANGED]: 'accountNameSaved',
  [I.USER.NOTIFICATION_PREFERENCES_UPDATED]: 'preferencesSaved',
  [I.FAVORITE.FAVORITE_RECORD_NOTE_UPDATED]: 'favoriteNoteSaved',
  [I.EMAIL.EMAIL_PREFERENCES_UPDATED]: 'preferencesSaved',
  [I.SALON_PROFILE.SALON_PROFILE_UPDATED]: 'salonProfileSaved',
  [I.SALON_PROFILE.SALON_PROFILE_VISIBILITY_UPDATED]: 'salonVisibilitySaved',
  [I.SUPPORT.SUPPORT_THREAD_CREATED]: 'supportCreated',
  [I.SUPPORT.SUPPORT_MESSAGE_SENT]: 'supportReplySent',
};
/**
 * Two sources decide that the success toast is not the owner of an outcome:
 * the call's declared `successFeedback` (any screen, admin included) and the
 * app-surface moment registry above (keyed by event, `/app` outside admin,
 * where the outcome scenes live). Errors are never suppressed here.
 */
export const shouldSuppressSuccessToast = (
  event: EVENT_INFO_TYPE,
  color: string,
  pathname: string,
  declared: SuccessFeedbackOwner = 'event'
): boolean => {
  if (color === 'success' && declared !== 'event') {
    return true;
  }
  const moment = EVENT_MOMENTS[event];
  if (
    color !== 'success' ||
    moment === undefined ||
    !/^\/(?:pl\/|en\/|de\/)?app(?:\/|$)/.test(pathname) ||
    /^\/(?:pl\/|en\/|de\/)?app\/admin(?:\/|$)/.test(pathname)
  ) {
    return false;
  }
  return (
    resolveOutcomeLevel(moment, {
      confirmed: true,
      changed: true,
      source: 'action',
    }) !== 'L3'
  );
};
