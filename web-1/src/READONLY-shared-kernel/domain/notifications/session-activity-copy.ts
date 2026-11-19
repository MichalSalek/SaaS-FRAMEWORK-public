import type { LocaleType } from '../i18n/i18n.config';
import type {
  SessionActivityKind,
  SessionChangeScope,
} from '../../models/db_models.generated.dto';

export type SessionActivityMetadata = {
  activity_kind?: SessionActivityKind | null;
  change_scope?: SessionChangeScope | null;
};

const COPY = {
  pl: {
    submitted: 'Udostępniono sesję inspiracji do akceptacji',
    accepted: 'Zaakceptowano sesję inspiracji',
    changed: 'Zmiany po akceptacji',
    PHOTOS: 'zdjęcia',
    NOTE: 'notatka',
    PHOTOS_AND_NOTE: 'zdjęcia i notatka',
    body: 'Otwórz rozmowę, żeby zobaczyć sesję inspiracji.',
  },
  en: {
    submitted: 'Inspiration session shared for acceptance',
    accepted: 'Inspiration session accepted',
    changed: 'Changes after acceptance',
    PHOTOS: 'photos',
    NOTE: 'note',
    PHOTOS_AND_NOTE: 'photos and note',
    body: 'Open the conversation to see the inspiration session.',
  },
  de: {
    submitted: 'Inspirationssitzung zur Annahme geteilt',
    accepted: 'Inspirationssitzung angenommen',
    changed: 'Änderungen nach der Annahme',
    PHOTOS: 'Fotos',
    NOTE: 'Notiz',
    PHOTOS_AND_NOTE: 'Fotos und Notiz',
    body: 'Öffnen Sie die Unterhaltung, um die Inspirationssitzung zu sehen.',
  },
} as const;

export const renderSessionActivityCopy = (
  locale: LocaleType,
  activity?: SessionActivityMetadata
) => {
  if (!activity?.activity_kind || activity.activity_kind === 'TEXT') {
    return null;
  }
  const copy = COPY[locale];
  const title =
    activity.activity_kind === 'SESSION_SUBMITTED'
      ? copy.submitted
      : activity.activity_kind === 'SESSION_ACCEPTED'
        ? copy.accepted
        : activity.change_scope
          ? `${copy.changed}: ${copy[activity.change_scope]}`
          : copy.changed;
  return { title, body: copy.body };
};
