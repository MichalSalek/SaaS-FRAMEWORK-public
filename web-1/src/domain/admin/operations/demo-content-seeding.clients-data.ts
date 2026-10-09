import { CLOUDINARY_DEMO } from './demo-content-seeding.config';

/**
 * Dane 7 nowych klientek Ani (S111, 2026-09-14) — imiona, notatki CRM, wizyty
 * i wiadomości. Oddzielone od demo-content-seeding.config.ts, żeby żaden
 * pojedynczy plik nie zbliżał się do limitu ESLint max-lines. Zużywane przez
 * demo-content-seeding.clients.ts / .visits.ts / .messages.ts / .sessions.ts.
 */

export const SERVICE_NOTE_TEMPLATES: readonly string[] = [
  'Manicure z wizyty, udokumentowany na zdjęciach.',
] as const;

export interface DemoVisitSpec {
  daysAgo: number;
  serviceNoteIndex: number;
  resultPhotoCount: 1 | 2;
}

export interface DemoMessageSpec {
  sender: 'CLIENT' | 'STYLIST';
  content: string;
  hoursAgo: number;
}

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
      'Preferuje jasne, stonowane kolory i krótką długość. Bez lakieru hybrydowego na kciukach, ma tam wrażliwą skórę.',
    crmNoteUpdatedDaysAgo: 12,
    visits: [
      { daysAgo: 20, serviceNoteIndex: 0, resultPhotoCount: 1 },
      { daysAgo: 5, serviceNoteIndex: 4, resultPhotoCount: 2 },
    ],
    messages: [
      {
        sender: 'STYLIST',
        content:
          'Cześć Julia! Zapraszam na sesję inspiracji, wrzuciłam Ci nowe zdjęcia.',
        hoursAgo: 80,
      },
      {
        sender: 'CLIENT',
        content: 'Super, już zerknęłam, bardzo mi się podobają!',
        hoursAgo: 60,
      },
      {
        sender: 'STYLIST',
        content: 'Cieszę się, daj znać jak wybierzesz.',
        hoursAgo: 50,
      },
    ],
    stylistUnread: false,
    sharedSession: {
      name: 'Wzory na urodziny',
      clientNote:
        'Szukam czegoś delikatnego, ale z odrobiną błysku na tę okazję.',
      photoUrls: [
        `${CLOUDINARY_DEMO}/v1791414190/demo-seed/nail-13-short-pastel_review20261008.webp`,
        `${CLOUDINARY_DEMO}/v1791414185/demo-seed/hero-nail-05-floral_review20261008.webp`,
      ],
    },
  },
  {
    slug: 'magdalena',
    displayName: 'Magdalena Kowalczyk',
    email: 'demo-client-magdalena@example.com',
    pairedDaysAgo: 60,
    crmNote:
      'Uwielbia zdobienia i mocne kolory, najchętniej czerwień lub złoto. Kształt migdał, długość średnia.',
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
        content: 'Cześć! Widziałam nowe wzory na Twoim profilu, są przepiękne.',
        hoursAgo: 300,
      },
      {
        sender: 'STYLIST',
        content: 'Dziękuję bardzo! Miło mi to słyszeć.',
        hoursAgo: 290,
      },
      {
        sender: 'CLIENT',
        content: 'Chciałabym umówić się na korektę w przyszłym tygodniu.',
        hoursAgo: 200,
      },
      {
        sender: 'STYLIST',
        content: 'Jasne, napisz proszę, który dzień Ci pasuje.',
        hoursAgo: 190,
      },
      {
        sender: 'CLIENT',
        content: 'Może być środa po południu? Daj znać czy masz wolne.',
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
      'Zmieniła kształt na migdał, bardzo zadowolona. Lubi delikatne wzorki, unika brokatu.',
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
        content: 'Cześć! Zastanawiam się nad zmianą kształtu na migdał.',
        hoursAgo: 400,
      },
      {
        sender: 'STYLIST',
        content:
          'Migdał świetnie sprawdzi się przy Twojej długości płytki, chętnie pomogę.',
        hoursAgo: 390,
      },
      {
        sender: 'CLIENT',
        content: 'To się umawiamy, wysyłam Ci sesję z inspiracjami.',
        hoursAgo: 250,
      },
      {
        sender: 'STYLIST',
        content: 'Super, już widzę zdjęcia, mam kilka pomysłów na rozwinięcie.',
        hoursAgo: 240,
      },
    ],
    stylistUnread: false,
    sharedSession: {
      name: 'Nowy kształt',
      clientNote: 'Chcę porównać te kolory i wzory, zanim się zdecyduję.',
      photoUrls: [
        `${CLOUDINARY_DEMO}/v1791414191/demo-seed/nail-21-medium-red_review20261008.webp`,
        `${CLOUDINARY_DEMO}/v1791414191/demo-seed/nail-24-medium-floral_review20261008.webp`,
        `${CLOUDINARY_DEMO}/v1791414196/demo-seed/nail-42-medium-sage-micro-french_review20261008.webp`,
      ],
    },
  },
  {
    slug: 'zuzanna',
    displayName: 'Zuzanna Wójcik',
    email: 'demo-client-zuzanna@example.com',
    pairedDaysAgo: 120,
    crmNote:
      'Fanka zdobień 3D i efektownych wykończeń. Paznokcie krótkie, bo dużo pracuje ręcznie.',
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
          'Cześć Zuzanna! Tak, robię zdobienia 3D, chętnie pokażę przykłady na wizycie.',
        hoursAgo: 100,
      },
      {
        sender: 'CLIENT',
        content: 'Świetnie, w takim razie umawiam się na przyszły tydzień.',
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
      'Uczulenie na aceton, zdejmowanie wyłącznie łagodnym zmywaczem. Preferuje naturalne odcienie beżu.',
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
          'Cześć! Mam uczulenie na aceton, czy to problem przy zdejmowaniu hybrydy?',
        hoursAgo: 500,
      },
      {
        sender: 'STYLIST',
        content:
          'Nie ma problemu, używam łagodniejszego zmywacza, dam Ci znać jak się sprawdzi.',
        hoursAgo: 490,
      },
      {
        sender: 'STYLIST',
        content: 'Aha, i pamiętaj żeby nie moczyć rąk od razu po wizycie.',
        hoursAgo: 480,
      },
    ],
    stylistUnread: false,
    likesOnAniaGallery: [
      `${CLOUDINARY_DEMO}/v1791414185/demo-seed/hero-nail-05-floral_review20261008.webp`,
      `${CLOUDINARY_DEMO}/v1791414184/demo-seed/nail-45-long-champagne-chrome_review20261008.webp`,
      `${CLOUDINARY_DEMO}/v1791414198/demo-seed/nail-46-medium-tortoiseshell_review20261008.webp`,
    ],
  },
  {
    slug: 'weronika',
    displayName: 'Weronika Zielińska',
    email: 'demo-client-weronika@example.com',
    pairedDaysAgo: 180,
    crmNote: 'Kocha złote akcenty i chrom. Długość długa, kształt kwadrat.',
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
          'Cześć! Planuję wizytę na urodziny, chciałabym coś wyjątkowego.',
        hoursAgo: 700,
      },
      {
        sender: 'STYLIST',
        content:
          'Świetnie, mam kilka pomysłów na zdobienia, wyślę Ci sesję z inspiracjami.',
        hoursAgo: 690,
      },
      {
        sender: 'CLIENT',
        content: 'Bardzo dziękuję, już czekam!',
        hoursAgo: 600,
      },
      {
        sender: 'STYLIST',
        content: 'Właśnie wysłałam, zerknij kiedy będziesz miała chwilę.',
        hoursAgo: 500,
      },
      {
        sender: 'STYLIST',
        content: 'Cieszę się! Do zobaczenia na wizycie.',
        hoursAgo: 450,
      },
    ],
    stylistUnread: false,
    sharedSession: {
      name: 'Urodzinowe inspiracje',
      clientNote: 'Marzy mi się coś ze złotem, tak jak lubię. Co polecasz?',
      photoUrls: [
        `${CLOUDINARY_DEMO}/v1791414199/demo-seed/hero-nail-17-glazed-knit_review20261008.webp`,
        `${CLOUDINARY_DEMO}/v1791414184/demo-seed/nail-45-long-champagne-chrome_review20261008.webp`,
        `${CLOUDINARY_DEMO}/v1791414202/demo-seed/hero-nail-19-molten-french_review20261008.webp`,
        `${CLOUDINARY_DEMO}/v1791414204/demo-seed/nail-53-jelly-oil-droplet_review20261008.webp`,
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
        content: 'Cześć Paulina! Dawno się nie widziałyśmy, jak się miewasz?',
        hoursAgo: 50,
      },
      {
        sender: 'CLIENT',
        content:
          'Cześć! Wszystko dobrze, planuję wrócić na wizytę w tym miesiącu.',
        hoursAgo: 10,
      },
    ],
    stylistUnread: true,
    likesOnAniaGallery: [
      `${CLOUDINARY_DEMO}/v1791414192/demo-seed/nail-32-long-minimal-line_review20261008.webp`,
      `${CLOUDINARY_DEMO}/v1791414201/demo-seed/nail-51-medium-3d-gel-droplets_review20261008.webp`,
    ],
  },
] as const;
