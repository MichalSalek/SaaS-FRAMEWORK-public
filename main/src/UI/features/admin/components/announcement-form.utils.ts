// admin/components/announcement-form.utils.ts
// Form state, validation and the create/update payload for one announcement.
// Enabled locales are the only translations sent; the legacy title and message
// are the Polish slot, or the first enabled language when Polish is off.

import type {
  ADMIN_DTO_API_V1,
  AnnouncementType,
} from '@kernel/models/admin/admin.dto';
import { announcementTranslation } from '@kernel/domain/admin/announcement-content';
import type { AnnouncementTranslations } from '@kernel/domain/admin/announcement-content';
import { announcementPlainText } from '@kernel/domain/admin/announcement-links';
import { I18N_CONFIG, type LocaleType } from '@kernel/domain/i18n/i18n.config';
import { VALIDATION_LENGTHS } from '@kernel/policies/validation.config';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';

export const ANNOUNCEMENT_TITLE_MAX = VALIDATION_LENGTHS.ANNOUNCEMENT_TITLE_MAX;
export const ANNOUNCEMENT_MESSAGE_MAX =
  VALIDATION_LENGTHS.ANNOUNCEMENT_MESSAGE_MAX;
/** Android clips a push title near this length. A warning, not a block. */
export const ANNOUNCEMENT_PUSH_TITLE_SOFT_MAX = 65;
/** Android clips a push body after a few lines. A warning, not a block. */
export const ANNOUNCEMENT_PUSH_BODY_SOFT_MAX = 180;

export const ANNOUNCEMENT_LOCALES = I18N_CONFIG.locales;

export interface AnnouncementLocaleSlot {
  enabled: boolean;
  title: string;
  message: string;
}

export interface AnnouncementFormState {
  locales: Record<LocaleType, AnnouncementLocaleSlot>;
  type: AnnouncementType;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
  audience_anonymous: boolean;
  audience_client: boolean;
  audience_stylist: boolean;
}

const emptySlot = (enabled: boolean): AnnouncementLocaleSlot => ({
  enabled,
  title: '',
  message: '',
});

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementFormState = {
  locales: {
    pl: emptySlot(true),
    en: emptySlot(false),
    de: emptySlot(false),
  },
  type: 'info',
  is_active: false,
  starts_at: '',
  ends_at: '',
  audience_anonymous: true,
  audience_client: true,
  audience_stylist: true,
};

export const ANNOUNCEMENT_TYPE_OPTIONS: {
  value: AnnouncementType;
  labelKey: 'typeInfo' | 'typeWarning' | 'typeCritical';
}[] = [
  { value: 'info', labelKey: 'typeInfo' },
  { value: 'warning', labelKey: 'typeWarning' },
  { value: 'critical', labelKey: 'typeCritical' },
];

export type AnnouncementSubmitPayload =
  | {
      kind: 'create';
      data: ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST'];
    }
  | {
      kind: 'update';
      data: ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST'];
    };

export type AnnouncementIssue =
  | { code: 'language' }
  | { code: 'audience' }
  | { code: 'dates' }
  | {
      code: 'title-empty' | 'title-long' | 'message-empty' | 'message-long';
      locale: LocaleType;
    };

function toDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  const year = date.getUTCFullYear();
  const month = `${date.getUTCMonth() + 1}`.padStart(2, '0');
  const day = `${date.getUTCDate()}`.padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function dateInputToISO(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

// „Do" is an INCLUSIVE date: the admin enters the last day of display, so the end is the end of
// that day (UTC), not its start. With a midnight start the backend filter `ends_at >= now` switched
// the announcement off at 00:00 of the „to" day, and start == end of the same day failed the
// backend `starts_at < ends_at`.
function dateInputToEndOfDayISO(value: string): string | undefined {
  if (!value) {
    return undefined;
  }
  const date = new Date(`${value}T23:59:59.999Z`);
  if (Number.isNaN(date.getTime())) {
    return undefined;
  }
  return date.toISOString();
}

export function fromAnnouncement(
  ann: AdminAnnouncement
): AnnouncementFormState {
  const locales = {
    pl: emptySlot(false),
    en: emptySlot(false),
    de: emptySlot(false),
  } satisfies Record<LocaleType, AnnouncementLocaleSlot>;
  for (const locale of ANNOUNCEMENT_LOCALES) {
    const slot = ann.translations[locale];
    if (slot !== undefined) {
      locales[locale] = {
        enabled: true,
        title: slot.title,
        message: slot.message,
      };
    }
  }
  const anyLocale = ANNOUNCEMENT_LOCALES.some(
    locale => locales[locale].enabled
  );
  if (!anyLocale) {
    locales.pl = { enabled: true, title: ann.title, message: ann.message };
  }
  return {
    locales,
    type: ann.type,
    is_active: ann.is_active,
    starts_at: toDateInputValue(ann.starts_at),
    ends_at: toDateInputValue(ann.ends_at),
    audience_anonymous: ann.audience_anonymous,
    audience_client: ann.audience_client,
    audience_stylist: ann.audience_stylist,
  };
}

export function allAnnouncementAudiencesSelected(
  form: AnnouncementFormState
): boolean {
  return (
    form.audience_anonymous && form.audience_client && form.audience_stylist
  );
}

export function isAnnouncementFormDirty(
  form: AnnouncementFormState,
  initial: AnnouncementFormState
): boolean {
  if (
    form.type !== initial.type ||
    form.is_active !== initial.is_active ||
    form.starts_at !== initial.starts_at ||
    form.ends_at !== initial.ends_at ||
    form.audience_anonymous !== initial.audience_anonymous ||
    form.audience_client !== initial.audience_client ||
    form.audience_stylist !== initial.audience_stylist
  ) {
    return true;
  }
  return ANNOUNCEMENT_LOCALES.some(locale => {
    const left = form.locales[locale];
    const right = initial.locales[locale];
    return (
      left.enabled !== right.enabled ||
      left.title !== right.title ||
      left.message !== right.message
    );
  });
}

export function announcementFormIssues(
  form: AnnouncementFormState
): AnnouncementIssue[] {
  const issues: AnnouncementIssue[] = [];
  const enabled = ANNOUNCEMENT_LOCALES.filter(
    locale => form.locales[locale].enabled
  );
  if (enabled.length === 0) {
    issues.push({ code: 'language' });
  }
  for (const locale of enabled) {
    const slot = form.locales[locale];
    const title = slot.title.trim();
    const message = slot.message.trim();
    if (title.length === 0) {
      issues.push({ code: 'title-empty', locale });
    } else if (title.length > ANNOUNCEMENT_TITLE_MAX) {
      issues.push({ code: 'title-long', locale });
    }
    if (message.length === 0) {
      issues.push({ code: 'message-empty', locale });
    } else if (message.length > ANNOUNCEMENT_MESSAGE_MAX) {
      issues.push({ code: 'message-long', locale });
    }
  }
  if (
    !form.audience_anonymous &&
    !form.audience_client &&
    !form.audience_stylist
  ) {
    issues.push({ code: 'audience' });
  }
  if (form.starts_at && form.ends_at) {
    const startTime = new Date(form.starts_at).getTime();
    const endTime = new Date(form.ends_at).getTime();
    if (endTime < startTime) {
      issues.push({ code: 'dates' });
    }
  }
  return issues;
}

/** Locales whose push text will be clipped. Empty when nobody in the app is a recipient. */
export function announcementPushSoftLocales(
  form: AnnouncementFormState
): LocaleType[] {
  if (!form.audience_client && !form.audience_stylist) {
    return [];
  }
  return ANNOUNCEMENT_LOCALES.filter(locale => {
    const slot = form.locales[locale];
    if (!slot.enabled) {
      return false;
    }
    const title = slot.title.trim().length > ANNOUNCEMENT_PUSH_TITLE_SOFT_MAX;
    const body =
      announcementPlainText(slot.message).trim().length >
      ANNOUNCEMENT_PUSH_BODY_SOFT_MAX;
    return title || body;
  });
}

export function enabledAnnouncementTranslations(
  form: AnnouncementFormState
): AnnouncementTranslations {
  const translations: AnnouncementTranslations = {};
  for (const locale of ANNOUNCEMENT_LOCALES) {
    const slot = form.locales[locale];
    if (slot.enabled) {
      translations[locale] = {
        title: slot.title.trim(),
        message: slot.message.trim(),
      };
    }
  }
  return translations;
}

export function buildAnnouncementSubmitPayload(
  form: AnnouncementFormState,
  editing: AdminAnnouncement | null
): AnnouncementSubmitPayload {
  const translations = enabledAnnouncementTranslations(form);
  const primary = announcementTranslation(translations, 'pl', true) ?? {
    title: '',
    message: '',
  };
  const audience = {
    audience_anonymous: form.audience_anonymous,
    audience_client: form.audience_client,
    audience_stylist: form.audience_stylist,
  };
  if (editing) {
    return {
      kind: 'update',
      data: {
        id: editing.id,
        title: primary.title,
        message: primary.message,
        type: form.type,
        is_active: form.is_active,
        starts_at: dateInputToISO(form.starts_at) ?? null,
        ends_at: dateInputToEndOfDayISO(form.ends_at) ?? null,
        translations,
        ...audience,
      },
    };
  }
  const startsISO = dateInputToISO(form.starts_at);
  const endsISO = dateInputToEndOfDayISO(form.ends_at);
  return {
    kind: 'create',
    data: {
      title: primary.title,
      message: primary.message,
      type: form.type,
      is_active: form.is_active,
      translations,
      ...audience,
      ...(startsISO !== undefined ? { starts_at: startsISO } : {}),
      ...(endsISO !== undefined ? { ends_at: endsISO } : {}),
    },
  };
}
