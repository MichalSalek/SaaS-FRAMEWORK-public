import { TIME } from '@kernel/application/constants.config';
import { CLOUDINARY_DEMO } from './demo-content-seeding.config';

/**
 * Data for Ania's seven newer clients: names, CRM notes, visits and messages.
 * Split from demo-content-seeding.config.ts so no single file nears the ESLint
 * max-lines limit. Consumed by demo-content-seeding.clients.ts, .visits.ts,
 * .messages.ts and .sessions.ts.
 */

/**
 * Notatki stylistki po wizycie (karta klientki, „Historia wizyt”). Każda
 * wizyta bierze notatkę po `serviceNoteIndex % length`.
 *
 * DECISION: demo data lands on public-page screenshots and must read as written by a real stylist,
 * never one repeated sentence. The Polish wording of these notes comes from another model family
 * (GPT); do not write new ones yourself. Put retired sentences in RETIRED_SERVICE_NOTES and the next
 * seed replaces them in existing visits. (owner)
 */
export const SERVICE_NOTE_TEMPLATES: readonly string[] = [
  'Hybryda w jasnym beżu, średni migdał. Na następną wizytę skrócić o 1 mm.',
  'Mleczny żel na krótkim kwadracie. Następnym razem zostawić tę samą długość.',
  'Czerwona hybryda na krótkim owalu. Kolor krył równo przy dwóch cienkich warstwach.',
  'Bordo na żelu, średni migdał. Przy kolejnym uzupełnieniu odsunąć kolor od skórek.',
  'Złoty french na mlecznej bazie, żel i długi migdał. Zachować ten sam łuk.',
  'Biały french na nude, hybryda na średnim kwadracie. Następnym razem cieńsza linia.',
  'Perłowe wykończenie na mlecznym żelu, krótki owal. Przy kolejnej wizycie użyć topu bez drobinek.',
  'Pastelowy róż na hybrydzie, krótki kwadrat. Następnym razem wybrać odcień mniej chłodny.',
  'Chrom na nude bazie, żel i średni migdał. Przy uzupełnieniu zostawić paznokcie tej długości.',
  'Jasny nude w hybrydzie na krótkim migdale. Następnym razem zmienić kształt na owal.',
] as const;

/** Exact sentences the seed no longer uses (see `seedVisits_IO`). */
export const RETIRED_SERVICE_NOTES: readonly string[] = [
  'Manicure z wizyty, udokumentowany na zdjęciach.',
] as const;

export interface DemoVisitSpec {
  daysAgo: number;
  serviceNoteIndex: number;
  resultPhotoCount: 1 | 2;
}

/** Hour and minute (UTC) that a demo timestamp is pinned to. */
export type DemoClockUtc = readonly [hour: number, minute: number];

export interface DemoMessageSpec {
  sender: 'CLIENT' | 'STYLIST';
  content: string;
  hoursAgo: number;
  /**
   * DECISION: the conversation on public screenshots must look real, and "now minus N hours" carried
   * whatever hour the seed ran at (a stylist replying at 01:55 reads as test data). This pins the time
   * of day. It applies only from 24 hours back (resolveDemoTime), where the day is surely yesterday and
   * the result never lands in the future. (owner)
   */
  clockUtc?: DemoClockUtc;
}

/** Od ilu godzin wstecz wolno przypiąć porę dnia (patrz `DemoMessageSpec.clockUtc`). */
const DEMO_CLOCK_MIN_HOURS_AGO = 24;

/** Znacznik czasu demo: `now` minus `hoursAgo`, z opcjonalnie przypiętą porą dnia. */
export const resolveDemoTime = (
  now: Date,
  hoursAgo: number,
  clockUtc?: DemoClockUtc
): Date => {
  const at = new Date(now.getTime() - hoursAgo * TIME.MS_PER_HOUR);
  if (clockUtc && hoursAgo >= DEMO_CLOCK_MIN_HOURS_AGO) {
    at.setUTCHours(clockUtc[0], clockUtc[1], 0, 0);
  }
  return at;
};

export interface DemoSharedSessionSpec {
  name: string;
  clientNote: string;
  photoUrls: readonly string[];
}

export interface DemoNewClientSpec {
  slug: string;
  displayName: string;
  email: string;
  pairedDaysAgo: number;
  crmNote: string;
  crmNoteUpdatedDaysAgo: number;
  visits: readonly DemoVisitSpec[];
  messages: readonly DemoMessageSpec[];
  /** true = ostatnia wiadomość klientki nieprzeczytana przez stylistkę. */
  stylistUnread: boolean;
  sharedSession?: DemoSharedSessionSpec;
  likesOnAniaGallery?: readonly string[];
}

export const DEMO_NEW_CLIENTS: readonly DemoNewClientSpec[] = [
  {
    slug: 'julia',
    displayName: 'Julia Nowak',
    email: 'demo-client-julia@example.com',
    pairedDaysAgo: 30,
    crmNote:
      'Lubi jasne, stonowane kolory i krótkie paznokcie. Na kciukach bez hybrydy, bo ma tam wrażliwą skórę.',
    crmNoteUpdatedDaysAgo: 12,
    visits: [
      { daysAgo: 20, serviceNoteIndex: 0, resultPhotoCount: 1 },
      { daysAgo: 5, serviceNoteIndex: 4, resultPhotoCount: 2 },
    ],
    messages: [
      {
        sender: 'STYLIST',
        content:
          'Cześć Julio, wrzuciłam Ci nowe zdjęcia do sesji inspiracji. Możesz już obejrzeć.',
        hoursAgo: 80,
      },
      {
        sender: 'CLIENT',
        content: 'Już zerknęłam, bardzo mi się podobają.',
        hoursAgo: 60,
      },
      {
        sender: 'STYLIST',
        content: 'Daj znać, jak już coś wybierzesz.',
        hoursAgo: 50,
      },
    ],
    stylistUnread: false,
    sharedSession: {
      name: 'Wzory na urodziny',
      clientNote: 'Na urodziny chciałabym coś delikatnego z odrobiną błysku.',
      photoUrls: [
        `${CLOUDINARY_DEMO}/v9/demo-seed/portfolio-sample-028_rev2.webp`,
        `${CLOUDINARY_DEMO}/v5/demo-seed/portfolio-sample-005_rev2.webp`,
      ],
    },
  },
  {
    slug: 'magdalena',
    displayName: 'Magdalena Kowalczyk',
    email: 'demo-client-magdalena@example.com',
    pairedDaysAgo: 60,
    crmNote:
      'Lubi zdobienia i mocne kolory, zwłaszcza czerwień i złoto. Wybiera średni migdał.',
    crmNoteUpdatedDaysAgo: 20,
    visits: [
      { daysAgo: 55, serviceNoteIndex: 1, resultPhotoCount: 1 },
      { daysAgo: 40, serviceNoteIndex: 5, resultPhotoCount: 2 },
      { daysAgo: 25, serviceNoteIndex: 8, resultPhotoCount: 1 },
      { daysAgo: 10, serviceNoteIndex: 2, resultPhotoCount: 2 },
    ],
    messages: [
      {
        sender: 'CLIENT',
        content: 'Cześć, widziałam nowe wzory na Twoim profilu. Przepiękne.',
        hoursAgo: 300,
      },
      {
        sender: 'STYLIST',
        content: 'Dziękuję, cieszę się, że Ci się podobają.',
        hoursAgo: 290,
      },
      {
        sender: 'CLIENT',
        content: 'Chciałabym umówić się na korektę w przyszłym tygodniu.',
        hoursAgo: 200,
      },
      {
        sender: 'STYLIST',
        content: 'Jasne, który dzień Ci pasuje?',
        hoursAgo: 190,
      },
      {
        sender: 'CLIENT',
        content: 'Masz może wolny termin w środę po południu?',
        hoursAgo: 20,
      },
    ],
    stylistUnread: true,
  },
  {
    slug: 'natalia',
    displayName: 'Natalia Lewandowska',
    email: 'demo-client-natalia@example.com',
    pairedDaysAgo: 90,
    crmNote:
      'Jest bardzo zadowolona ze zmiany kształtu na migdał. Lubi delikatne zdobienia, bez brokatu.',
    crmNoteUpdatedDaysAgo: 30,
    visits: [
      { daysAgo: 85, serviceNoteIndex: 3, resultPhotoCount: 1 },
      { daysAgo: 65, serviceNoteIndex: 6, resultPhotoCount: 2 },
      { daysAgo: 45, serviceNoteIndex: 9, resultPhotoCount: 1 },
      { daysAgo: 25, serviceNoteIndex: 0, resultPhotoCount: 2 },
      { daysAgo: 8, serviceNoteIndex: 7, resultPhotoCount: 1 },
    ],
    messages: [
      {
        sender: 'CLIENT',
        content: 'Cześć, myślę o zmianie kształtu na migdał.',
        hoursAgo: 400,
      },
      {
        sender: 'STYLIST',
        content:
          'Przy Twojej długości płytki możemy zrobić migdał. Chętnie Ci pomogę.',
        hoursAgo: 390,
      },
      {
        sender: 'CLIENT',
        content: 'To jesteśmy umówione. Wysyłam Ci sesję inspiracji.',
        hoursAgo: 250,
      },
      {
        sender: 'STYLIST',
        content:
          'Już widzę zdjęcia. Mam kilka pomysłów, co możemy z nimi zrobić.',
        hoursAgo: 240,
      },
    ],
    stylistUnread: false,
    sharedSession: {
      name: 'Nowy kształt',
      clientNote: 'Chcę porównać te kolory i wzory, zanim się zdecyduję.',
      photoUrls: [
        `${CLOUDINARY_DEMO}/v10/demo-seed/portfolio-sample-036_rev2.webp`,
        `${CLOUDINARY_DEMO}/v10/demo-seed/portfolio-sample-039_rev2.webp`,
        `${CLOUDINARY_DEMO}/v14/demo-seed/portfolio-sample-057_rev2.webp`,
      ],
    },
  },
  {
    slug: 'zuzanna',
    displayName: 'Zuzanna Wójcik',
    email: 'demo-client-zuzanna@example.com',
    pairedDaysAgo: 120,
    crmNote:
      'Lubi zdobienia 3D i efektowne wykończenia. Nosi krótkie paznokcie, bo dużo pracuje rękami.',
    crmNoteUpdatedDaysAgo: 40,
    visits: [
      { daysAgo: 110, serviceNoteIndex: 10, resultPhotoCount: 1 },
      { daysAgo: 70, serviceNoteIndex: 2, resultPhotoCount: 2 },
      { daysAgo: 20, serviceNoteIndex: 11, resultPhotoCount: 1 },
    ],
    messages: [
      {
        sender: 'STYLIST',
        content:
          'Cześć Zuzanno, robię zdobienia 3D. Na wizycie chętnie pokażę Ci przykłady.',
        hoursAgo: 100,
      },
      {
        sender: 'CLIENT',
        content: 'W takim razie chciałabym umówić się na przyszły tydzień.',
        hoursAgo: 30,
      },
    ],
    stylistUnread: true,
  },
  {
    slug: 'aleksandra',
    displayName: 'Aleksandra Kamińska',
    email: 'demo-client-aleksandra@example.com',
    pairedDaysAgo: 150,
    crmNote:
      'Ma uczulenie na aceton. Zdejmowanie tylko łagodnym zmywaczem. Lubi naturalne odcienie beżu.',
    crmNoteUpdatedDaysAgo: 45,
    visits: [
      { daysAgo: 140, serviceNoteIndex: 1, resultPhotoCount: 1 },
      { daysAgo: 115, serviceNoteIndex: 4, resultPhotoCount: 2 },
      { daysAgo: 90, serviceNoteIndex: 7, resultPhotoCount: 1 },
      { daysAgo: 65, serviceNoteIndex: 9, resultPhotoCount: 2 },
      { daysAgo: 40, serviceNoteIndex: 3, resultPhotoCount: 1 },
      { daysAgo: 10, serviceNoteIndex: 6, resultPhotoCount: 2 },
    ],
    messages: [
      {
        sender: 'CLIENT',
        content:
          'Cześć, mam uczulenie na aceton. Czy to będzie problem przy zdejmowaniu hybrydy?',
        hoursAgo: 500,
      },
      {
        sender: 'STYLIST',
        content:
          'Dziękuję, że dałaś znać. Sprawdzę skład produktu przed wizytą i dam Ci znać, czy mogę go użyć.',
        hoursAgo: 490,
      },
      {
        sender: 'STYLIST',
        content: 'Daj znać, jak Ci się nosi nowa stylizacja.',
        hoursAgo: 480,
      },
    ],
    stylistUnread: false,
    likesOnAniaGallery: [
      `${CLOUDINARY_DEMO}/v5/demo-seed/portfolio-sample-005_rev2.webp`,
      `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-060_rev2.webp`,
      `${CLOUDINARY_DEMO}/v16/demo-seed/portfolio-sample-061_rev2.webp`,
    ],
  },
  {
    slug: 'weronika',
    displayName: 'Weronika Zielińska',
    email: 'demo-client-weronika@example.com',
    pairedDaysAgo: 180,
    crmNote:
      'Lubi złote akcenty i chrom. Nosi długie paznokcie w kształcie kwadratu.',
    crmNoteUpdatedDaysAgo: 55,
    visits: [
      { daysAgo: 170, serviceNoteIndex: 5, resultPhotoCount: 1 },
      { daysAgo: 120, serviceNoteIndex: 8, resultPhotoCount: 2 },
      { daysAgo: 70, serviceNoteIndex: 0, resultPhotoCount: 1 },
      { daysAgo: 20, serviceNoteIndex: 10, resultPhotoCount: 2 },
    ],
    messages: [
      {
        sender: 'CLIENT',
        content:
          'Cześć, chciałabym umówić się przed urodzinami i zrobić coś wyjątkowego.',
        hoursAgo: 700,
      },
      {
        sender: 'STYLIST',
        content: 'Mam kilka pomysłów na zdobienia. Wyślę Ci sesję inspiracji.',
        hoursAgo: 690,
      },
      {
        sender: 'CLIENT',
        content: 'Dziękuję, czekam na zdjęcia.',
        hoursAgo: 600,
      },
      {
        sender: 'STYLIST',
        content: 'Wysłałam Ci sesję, zerknij, kiedy będziesz miała chwilę.',
        hoursAgo: 500,
      },
      {
        sender: 'STYLIST',
        content: 'Cieszę się. Do zobaczenia na wizycie.',
        hoursAgo: 450,
      },
    ],
    stylistUnread: false,
    sharedSession: {
      name: 'Urodzinowe inspiracje',
      clientNote: 'Chciałabym coś ze złotem. Co byś mi poleciła?',
      photoUrls: [
        `${CLOUDINARY_DEMO}/v17/demo-seed/portfolio-sample-015_rev2.webp`,
        `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-060_rev2.webp`,
        `${CLOUDINARY_DEMO}/v20/demo-seed/portfolio-sample-017_rev2.webp`,
        `${CLOUDINARY_DEMO}/v22/demo-seed/portfolio-sample-068_rev2.webp`,
      ],
    },
  },
  {
    slug: 'paulina',
    displayName: 'Paulina Dąbrowska',
    email: 'demo-client-paulina@example.com',
    pairedDaysAgo: 240,
    crmNote:
      'Wraca po dłuższej przerwie, wcześniej wybierała klasyczny french. Krótkie paznokcie, bardzo delikatna płytka.',
    crmNoteUpdatedDaysAgo: 70,
    visits: [{ daysAgo: 200, serviceNoteIndex: 11, resultPhotoCount: 2 }],
    messages: [
      {
        sender: 'STYLIST',
        content: 'Cześć Paulino, dawno się nie widziałyśmy. Co u Ciebie?',
        hoursAgo: 50,
      },
      {
        sender: 'CLIENT',
        content:
          'Cześć, u mnie wszystko dobrze. Chciałabym przyjść w tym miesiącu.',
        hoursAgo: 10,
      },
    ],
    stylistUnread: true,
    likesOnAniaGallery: [
      `${CLOUDINARY_DEMO}/v11/demo-seed/portfolio-sample-047_rev2.webp`,
      `${CLOUDINARY_DEMO}/v19/demo-seed/portfolio-sample-066_rev2.webp`,
    ],
  },
] as const;
