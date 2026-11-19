import {
  ContentReportReasonValue,
  ContentReportStatusValue,
  SupportThreadStatusValue,
  type ContentReportReason,
  type ContentReportStatus,
  type SupportThreadStatus,
} from '@kernel/models/db_models.generated.dto';
import type { AnnouncementType } from '@kernel/models/admin/admin.dto';

/**
 * Dane „zaplecza" wystawy demo: wątki supportu w każdym statusie, zgłoszenia
 * moderacyjne, komunikaty administracyjne i subskrybenci newslettera. Wszystko
 * na kontach demo (@example.com). Orkiestracja:
 * demo-content-seeding.community-extras.ts.
 */

export interface DemoSupportThreadSpec {
  /** Email właściciela wątku (konto demo). */
  userEmail: string;
  subject: string;
  status: SupportThreadStatus;
  daysAgo: number;
  messages: readonly {
    fromSupport: boolean;
    content: string;
    /** Exact prior seed reply; only this text is eligible for a re-seed update. */
    retiredContent?: string;
  }[];
}

export const DEMO_COMMUNITY_SUPPORT_THREADS: readonly DemoSupportThreadSpec[] =
  [
    {
      userEmail: 'demo-stylist-main@example.com',
      subject: 'Jak dodać kolejną osobę do zespołu salonu?',
      status: SupportThreadStatusValue.RESOLVED,
      daysAgo: 9,
      messages: [
        {
          fromSupport: false,
          content:
            'Od listopada dołącza do nas trzecia stylistka. Gdzie wysyłam jej zaproszenie i czy musi mieć własne konto?',
        },
        {
          fromSupport: true,
          content:
            'Nowa osoba potrzebuje własnego konta stylistki. Po zaakceptowaniu zaproszenia zobaczy galerię salonu.',
          retiredContent:
            'Dzień dobry! Zaproszenie wyślesz w Koncie, w sekcji Zespół salonu. Nowa osoba potrzebuje własnego konta stylistki, może być na planie Free. Po zaakceptowaniu zobaczy galerię salonu.',
        },
        {
          fromSupport: false,
          content: 'Działa, dziękuję za szybką odpowiedź.',
        },
      ],
    },
    {
      userEmail: 'demo-stylist-ewelina@example.com',
      subject: 'Czy mogę zmienić adres swojego profilu?',
      status: SupportThreadStatusValue.OPEN,
      daysAgo: 1,
      messages: [
        {
          fromSupport: false,
          content:
            'Przy zakładaniu konta wpisałam nazwę z literówką. Czy da się zmienić adres wizytówki bez zakładania nowego konta?',
        },
      ],
    },
    {
      userEmail: 'demo-client-oliwia@example.com',
      subject: 'Nie dostaję powiadomień o wiadomościach',
      status: SupportThreadStatusValue.CLOSED,
      daysAgo: 16,
      messages: [
        {
          fromSupport: false,
          content:
            'Stylistka napisała do mnie wczoraj, a ja zobaczyłam to dopiero po wejściu do aplikacji. Czy coś mam wyłączone?',
        },
        {
          fromSupport: true,
          content:
            'Cześć Oliwia! Sprawdź w Koncie przełącznik powiadomień i folder spamu w poczcie. Jeśli po tym nadal nic nie przychodzi, odpisz, a sprawdzimy wysyłkę.',
        },
      ],
    },
  ];

export interface DemoContentReportSpec {
  reporterEmail: string;
  /** Slug stylistki i NAZWA pliku z jej galerii (jak w community-data). */
  stylistSlug: string;
  photo: string;
  reason: ContentReportReason;
  status: ContentReportStatus;
  description: string;
  adminNote?: string;
  daysAgo: number;
}

export const DEMO_COMMUNITY_CONTENT_REPORTS: readonly DemoContentReportSpec[] =
  [
    {
      reporterEmail: 'demo-client-hanna@example.com',
      stylistSlug: 'sylwia',
      photo: 'portfolio-sample-012',
      reason: ContentReportReasonValue.OTHER,
      status: ContentReportStatusValue.PENDING,
      description:
        'Wydaje mi się, że to zdjęcie widziałam wcześniej na profilu innego salonu.',
      daysAgo: 2,
    },
    {
      reporterEmail: 'demo-client-oliwia@example.com',
      stylistSlug: 'monika',
      photo: 'portfolio-sample-041',
      reason: ContentReportReasonValue.SPAM,
      status: ContentReportStatusValue.REJECTED,
      description: 'Na zdjęciu jest reklama innego gabinetu.',
      adminNote:
        'Sprawdzone: zdjęcie autorskie, bez reklamy. Zgłoszenie odrzucone.',
      daysAgo: 12,
    },
  ];

export interface DemoAnnouncementSpec {
  title: string;
  message: string;
  type: AnnouncementType;
  isActive: boolean;
  startsDaysAgo: number | null;
  endsDaysAgo: number | null;
}

// DECISION: no demo announcement is live in the current window. A live one renders a banner on every
// public page (PublicLayout) and breaks screenshots and visual QA on dev/staging. The admin panel gets
// an ended one and a disabled draft; the banner is switched on by hand.
export const DEMO_COMMUNITY_ANNOUNCEMENTS: readonly DemoAnnouncementSpec[] = [
  {
    title: 'Nowy wygląd galerii',
    message:
      'Galeria dostała większe miniatury i szybsze filtrowanie po kolorach. Daj znać, jak Ci się pracuje.',
    type: 'info',
    isActive: true,
    startsDaysAgo: 40,
    endsDaysAgo: 26,
  },
  {
    title: 'Przerwa techniczna w nocy z soboty na niedzielę',
    message:
      'Między 2 a 4 w nocy aplikacja może działać wolniej. Twoje zdjęcia i wiadomości są bezpieczne.',
    type: 'warning',
    isActive: false,
    startsDaysAgo: null,
    endsDaysAgo: null,
  },
];

export interface DemoNewsletterSpec {
  email: string;
  source: string;
  subscribedDaysAgo: number;
  unsubscribedDaysAgo: number | null;
}

export const DEMO_COMMUNITY_NEWSLETTER: readonly DemoNewsletterSpec[] = [
  {
    email: 'demo-newsletter-ewa@example.com',
    source: 'footer',
    subscribedDaysAgo: 34,
    unsubscribedDaysAgo: null,
  },
  {
    email: 'demo-newsletter-iga@example.com',
    source: 'blog',
    subscribedDaysAgo: 70,
    unsubscribedDaysAgo: 11,
  },
];
