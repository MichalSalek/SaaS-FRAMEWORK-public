import type { LocaleType } from '../i18n/i18n.config';
import type { NotificationType } from '../../models/db_models.generated.dto';
import {
  renderSessionActivityCopy,
  type SessionActivityMetadata,
} from './session-activity-copy';

/**
 * The words of every notification, per language: ONE source for the row in the app (rendered by
 * the front in the interface language) and for the push (rendered by the backend in the
 * recipient's language).
 *
 * DECISION: not in `main/src/locales/common.json` (web-1 renders the push and cannot read the
 * front's dictionaries) and not stored in the row (a language switch would show the old language).
 * A TS module, so both apps import it typed and a missing type or language fails the build.
 * `{name}` is the display name of the OTHER person (or the salon); a row without a name uses
 * `titleNoName`, never an empty slot or an e-mail. SUPPORT_REPLY_RECEIVED has no person: the sender
 * is the team, never the admin's name or the thread subject, so both titles match.
 */
export type NotificationCopy = {
  title: string;
  titleNoName: string;
  body: string;
};

export type NotificationCopyTable = Record<
  LocaleType,
  Record<NotificationType, NotificationCopy>
>;

export const NOTIFICATION_COPY: NotificationCopyTable = Object.freeze({
  pl: {
    SYSTEM_ANNOUNCEMENT: {
      title: 'Ogłoszenie Nailfolio',
      titleNoName: 'Ogłoszenie Nailfolio',
      body: 'Otwórz powiadomienia, żeby przeczytać ogłoszenie.',
    },
    PAIR_REQUEST_RECEIVED: {
      title: '{name} prosi o połączenie',
      titleNoName: 'Nowa prośba o połączenie',
      body: 'Przyjmij albo odrzuć prośbę na liście klientek.',
    },
    PAIR_REQUEST_ACCEPTED: {
      title: '{name} przyjęła Twoją prośbę',
      titleNoName: 'Stylistka przyjęła Twoją prośbę',
      body: 'Jesteście już połączone, więc możesz oglądać jej galerię i pisać do niej.',
    },
    PAIR_CONNECTED_BY_QR: {
      title: '{name} połączyła się z Tobą',
      titleNoName: 'Nowa klientka połączyła się z Tobą',
      body: 'Zeskanowała Twój kod QR i jest już na liście klientek.',
    },
    SESSION_SHARED: {
      title: '{name} udostępniła Ci sesję inspiracji',
      titleNoName: 'Klientka udostępniła Ci sesję inspiracji',
      body: 'Otwórz rozmowę, żeby zobaczyć sesję i odpowiedzieć.',
    },
    SESSION_CLOSED_BY_STYLIST: {
      title: '{name} zamknęła Twoją sesję',
      titleNoName: 'Stylistka zamknęła Twoją sesję',
      body: 'Po wizycie sesja została zamknięta i znajdziesz ją w swoich sesjach.',
    },
    SESSION_EXPIRING_SOON: {
      title: 'Sesja inspiracji wkrótce wygasa',
      titleNoName: 'Sesja inspiracji wkrótce wygasa',
      body: 'Otwórz sesję, żeby wrócić do inspiracji przed terminem.',
    },
    MESSAGE_RECEIVED: {
      title: '{name} napisała do Ciebie',
      titleNoName: 'Masz nową wiadomość',
      body: 'Otwórz rozmowę, żeby przeczytać wiadomość.',
    },
    SALON_INVITATION_RECEIVED: {
      title: 'Zaproszenie do zespołu salonu {name}',
      titleNoName: 'Zaproszenie do zespołu salonu',
      body: 'Przyjmij albo odrzuć zaproszenie.',
    },
    SALON_INVITATION_ACCEPTED: {
      title: '{name} dołączyła do Twojego zespołu',
      titleNoName: 'Nowa osoba dołączyła do Twojego zespołu',
      body: 'Zobacz zespół salonu.',
    },
    SUPPORT_REPLY_RECEIVED: {
      title: 'Zespół Nailfolio odpisał na Twoje zgłoszenie',
      titleNoName: 'Zespół Nailfolio odpisał na Twoje zgłoszenie',
      body: 'Otwórz zgłoszenie, żeby przeczytać odpowiedź.',
    },
  },
  en: {
    SYSTEM_ANNOUNCEMENT: {
      title: 'Nailfolio announcement',
      titleNoName: 'Nailfolio announcement',
      body: 'Open notifications to read the announcement.',
    },
    PAIR_REQUEST_RECEIVED: {
      title: '{name} wants to connect with you',
      titleNoName: 'New connection request',
      body: 'Accept or decline the request on your client list.',
    },
    PAIR_REQUEST_ACCEPTED: {
      title: '{name} accepted your request',
      titleNoName: 'Your stylist accepted your request',
      body: 'You are now connected, so you can browse her gallery and message her.',
    },
    PAIR_CONNECTED_BY_QR: {
      title: '{name} connected with you',
      titleNoName: 'A new client connected with you',
      body: 'She scanned your QR code and is on your client list.',
    },
    SESSION_SHARED: {
      title: '{name} shared an inspiration session',
      titleNoName: 'A client shared an inspiration session',
      body: 'Open the conversation to see the session and reply.',
    },
    SESSION_CLOSED_BY_STYLIST: {
      title: '{name} closed your session',
      titleNoName: 'Your stylist closed your session',
      body: 'The session has been closed after the visit and is listed in your sessions.',
    },
    SESSION_EXPIRING_SOON: {
      title: 'Your inspiration session expires soon',
      titleNoName: 'Your inspiration session expires soon',
      body: 'Open the session to return to the inspiration before it closes.',
    },
    MESSAGE_RECEIVED: {
      title: '{name} sent you a message',
      titleNoName: 'You have a new message',
      body: 'Open the conversation to read it.',
    },
    SALON_INVITATION_RECEIVED: {
      title: 'Invitation to the team at {name}',
      titleNoName: 'Invitation to a salon team',
      body: 'Accept or decline the invitation.',
    },
    SALON_INVITATION_ACCEPTED: {
      title: '{name} joined your team',
      titleNoName: 'Someone joined your team',
      body: 'See your salon team.',
    },
    SUPPORT_REPLY_RECEIVED: {
      title: 'The Nailfolio team replied to your request',
      titleNoName: 'The Nailfolio team replied to your request',
      body: 'Open your request to read the reply.',
    },
  },
  de: {
    SYSTEM_ANNOUNCEMENT: {
      title: 'Mitteilung von Nailfolio',
      titleNoName: 'Mitteilung von Nailfolio',
      body: 'Öffnen Sie die Benachrichtigungen, um die Mitteilung zu lesen.',
    },
    PAIR_REQUEST_RECEIVED: {
      title: '{name} möchte sich mit Ihnen verbinden',
      titleNoName: 'Neue Verbindungsanfrage',
      body: 'Nehmen Sie die Anfrage in Ihrer Kundinnenliste an oder lehnen Sie sie ab.',
    },
    PAIR_REQUEST_ACCEPTED: {
      title: '{name} hat Ihre Anfrage angenommen',
      titleNoName: 'Ihre Stylistin hat Ihre Anfrage angenommen',
      body: 'Sie sind jetzt verbunden und können ihre Galerie ansehen und ihr schreiben.',
    },
    PAIR_CONNECTED_BY_QR: {
      title: '{name} hat sich mit Ihnen verbunden',
      titleNoName: 'Eine neue Kundin hat sich mit Ihnen verbunden',
      body: 'Sie hat Ihren QR-Code gescannt und steht in Ihrer Kundinnenliste.',
    },
    SESSION_SHARED: {
      title: '{name} hat eine Inspirationssitzung mit Ihnen geteilt',
      titleNoName: 'Eine Kundin hat eine Inspirationssitzung mit Ihnen geteilt',
      body: 'Öffnen Sie die Unterhaltung, um die Sitzung zu sehen und zu antworten.',
    },
    SESSION_CLOSED_BY_STYLIST: {
      title: '{name} hat Ihre Sitzung geschlossen',
      titleNoName: 'Ihre Stylistin hat Ihre Sitzung geschlossen',
      body: 'Die Sitzung wurde nach dem Termin geschlossen und ist in Ihren Sitzungen zu finden.',
    },
    SESSION_EXPIRING_SOON: {
      title: 'Ihre Inspirationssitzung läuft bald ab',
      titleNoName: 'Ihre Inspirationssitzung läuft bald ab',
      body: 'Öffnen Sie die Sitzung, um vor Ablauf zu Ihren Inspirationen zurückzukehren.',
    },
    MESSAGE_RECEIVED: {
      title: '{name} hat Ihnen geschrieben',
      titleNoName: 'Sie haben eine neue Nachricht',
      body: 'Öffnen Sie die Unterhaltung, um sie zu lesen.',
    },
    SALON_INVITATION_RECEIVED: {
      title: 'Einladung zum Team von {name}',
      titleNoName: 'Einladung zu einem Salon-Team',
      body: 'Nehmen Sie die Einladung an oder lehnen Sie sie ab.',
    },
    SALON_INVITATION_ACCEPTED: {
      title: '{name} ist Ihrem Team beigetreten',
      titleNoName: 'Jemand ist Ihrem Team beigetreten',
      body: 'Sehen Sie sich Ihr Salon-Team an.',
    },
    SUPPORT_REPLY_RECEIVED: {
      title: 'Das Nailfolio-Team hat auf Ihre Anfrage geantwortet',
      titleNoName: 'Das Nailfolio-Team hat auf Ihre Anfrage geantwortet',
      body: 'Öffnen Sie Ihre Anfrage, um die Antwort zu lesen.',
    },
  },
});

/** The two lines of one notification in one language. */
export const renderNotificationCopy = (
  locale: LocaleType,
  type: NotificationType,
  actorName: string | null,
  activity?: SessionActivityMetadata
): { title: string; body: string } => {
  const sessionCopy = renderSessionActivityCopy(locale, activity);
  if (sessionCopy) {
    return sessionCopy;
  }
  const copy = NOTIFICATION_COPY[locale][type];
  const name = actorName?.trim() ?? '';
  return {
    title:
      name.length > 0 ? copy.title.replace('{name}', name) : copy.titleNoName,
    body: copy.body,
  };
};
