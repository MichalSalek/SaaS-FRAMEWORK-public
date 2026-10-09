// admin/components/announcement-form.utils.ts
// Form state, validation, and date helpers for AnnouncementCreateEditDialog.

import type {
  ADMIN_DTO_API_V1,
  AnnouncementType,
} from '@kernel/models/admin/admin.dto';
import type { AdminAnnouncement } from '../hooks/useAdminAnnouncements';

/* ─── Form state ─── */

export interface AnnouncementFormState {
  title: string;
  message: string;
  type: AnnouncementType;
  is_active: boolean;
  starts_at: string;
  ends_at: string;
}

export const EMPTY_ANNOUNCEMENT_FORM: AnnouncementFormState = {
  title: '',
  message: '',
  type: 'info',
  is_active: false,
  starts_at: '',
  ends_at: '',
};

// labelKey resolves against the `admin.announcements` i18n namespace (the same
// keys the card/preview badges use) — the type dropdown must localize like the
// rest of the feature instead of rendering hardcoded English.
export const ANNOUNCEMENT_TYPE_OPTIONS: {
  value: AnnouncementType;
  labelKey: 'typeInfo' | 'typeWarning' | 'typeCritical';
}[] = [
  { value: 'info', labelKey: 'typeInfo' },
  { value: 'warning', labelKey: 'typeWarning' },
  { value: 'critical', labelKey: 'typeCritical' },
];

/* ─── Submit payload (discriminated union) ─── */

export type AnnouncementSubmitPayload =
  | {
      kind: 'create';
      data: ADMIN_DTO_API_V1['ADMIN_CREATE_ANNOUNCEMENT']['REQUEST'];
    }
  | {
      kind: 'update';
      data: ADMIN_DTO_API_V1['ADMIN_UPDATE_ANNOUNCEMENT']['REQUEST'];
    };

/* ─── Date helpers ─── */

function toDateInputValue(value: string | null | undefined): string {
  if (!value) {
    return '';
  }
  // Backend returns ISO string. <input type='date'> expects YYYY-MM-DD.
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return '';
  }
  // Read UTC parts to stay symmetric with dateInputToISO's UTC-midnight write
  // (`${value}T00:00:00.000Z`). Reading LOCAL parts drifted the date one day on
  // every edit round-trip in negative-offset timezones (UTC-).
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

// „Do" jest datą WŁĄCZNĄ: admin wpisuje ostatni dzień wyświetlania, więc koniec
// to końcówka tej doby (UTC), nie jej początek. Z północą-startem backendowy
// filtr `ends_at >= now` gasił ogłoszenie o 00:00 dnia „do", a start == koniec
// tego samego dnia padał na backendowym `starts_at < ends_at`.
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
  return {
    title: ann.title,
    message: ann.message,
    type: ann.type,
    is_active: ann.is_active,
    starts_at: toDateInputValue(ann.starts_at),
    ends_at: toDateInputValue(ann.ends_at),
  };
}

/** The form holds something the server does not have yet. */
export function isAnnouncementFormDirty(
  form: AnnouncementFormState,
  initial: AnnouncementFormState
): boolean {
  return (
    form.title !== initial.title ||
    form.message !== initial.message ||
    form.type !== initial.type ||
    form.is_active !== initial.is_active ||
    form.starts_at !== initial.starts_at ||
    form.ends_at !== initial.ends_at
  );
}

/* ─── Validation ─── */

interface AnnouncementFormErrors {
  title?: string;
  message?: string;
  dates?: string;
}

type AnnouncementFormTranslator = (key: string) => string;

export function validateAnnouncementForm(
  form: AnnouncementFormState,
  t: AnnouncementFormTranslator
): AnnouncementFormErrors {
  const errors: AnnouncementFormErrors = {};
  if (!form.title.trim()) {
    errors.title = t('validationTitleRequired');
  }
  if (!form.message.trim()) {
    errors.message = t('validationContentRequired');
  }
  if (form.starts_at && form.ends_at) {
    const startTime = new Date(form.starts_at).getTime();
    const endTime = new Date(form.ends_at).getTime();
    if (endTime < startTime) {
      errors.dates = t('validationDatesOrder');
    }
  }
  return errors;
}

/* ─── Submit payload builder ─── */

export function buildAnnouncementSubmitPayload(
  form: AnnouncementFormState,
  editing: AdminAnnouncement | null
): AnnouncementSubmitPayload {
  if (editing) {
    return {
      kind: 'update',
      data: {
        id: editing.id,
        title: form.title.trim(),
        message: form.message.trim(),
        type: form.type,
        is_active: form.is_active,
        starts_at: dateInputToISO(form.starts_at) ?? null,
        ends_at: dateInputToEndOfDayISO(form.ends_at) ?? null,
      },
    };
  }
  const startsISO = dateInputToISO(form.starts_at);
  const endsISO = dateInputToEndOfDayISO(form.ends_at);
  return {
    kind: 'create',
    data: {
      title: form.title.trim(),
      message: form.message.trim(),
      type: form.type,
      is_active: form.is_active,
      ...(startsISO !== undefined ? { starts_at: startsISO } : {}),
      ...(endsISO !== undefined ? { ends_at: endsISO } : {}),
    },
  };
}
