import {
  AccountTypeValue,
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
  type AccountType,
  type PairingStatus,
} from '@kernel/models/db_models.generated.dto';
import type {
  DemoMessageSpec,
  DemoVisitSpec,
} from './demo-content-seeding.clients-data';

/**
 * Relacje warstwy „społeczności" wystawy demo: dwie nowe klientki, pary we
 * wszystkich statusach (ACTIVE przez kod QR, PENDING, REVOKED), wiadomości,
 * wizyty, lajki, zakładki i sesje w stanach, których S111 nie pokrywał
 * (READY, EXPIRED, CLOSED poza Anią). Kontekst i reguły zdjęć:
 * demo-content-seeding.community-stylists-data.ts.
 *
 * Slugi klientek: 'karolina' (DEMO_CLIENT), slugi DEMO_NEW_CLIENTS (S111) albo
 * DEMO_COMMUNITY_CLIENTS niżej. Slugi stylistek: 'ania' | 'ola' | 'nina' albo
 * DEMO_COMMUNITY_STYLISTS. `photo` to NAZWA pliku z banku (bez sufiksu
 * Cloudinary) i musi należeć do galerii TEJ stylistki, więc lajk i sesja zawsze
 * trafiają w jej własną pracę (pilnuje tego test demo-content-seeding.community-data).
 */

export interface DemoCommunityClientSpec {
  slug: string;
  email: string;
  displayName: string;
  contactPhone: string;
}

export const DEMO_COMMUNITY_CLIENTS: readonly DemoCommunityClientSpec[] = [
  {
    slug: 'hanna',
    email: 'demo-client-hanna@example.com',
    displayName: 'Hanna Kowalczyk',
    contactPhone: '+48 500 100 101',
  },
  {
    slug: 'oliwia',
    email: 'demo-client-oliwia@example.com',
    displayName: 'Oliwia Wróbel',
    contactPhone: '+48 500 100 102',
  },
];

export type DemoSessionStateSpec =
  | typeof SessionContainerLifecycleStateValue.READY
  | typeof SessionContainerLifecycleStateValue.EXPIRED
  | typeof SessionContainerLifecycleStateValue.CLOSED;

export interface DemoCommunitySessionSpec {
  name: string;
  state: DemoSessionStateSpec;
  clientNote?: string;
  stylistNote?: string;
  photos: readonly string[];
  /** EXPIRED/CLOSED: kiedy sesję udostępniono (okno 7 dni liczone od tej daty). */
  sharedDaysAgo?: number;
}

export interface DemoCommunityPairSpec {
  clientSlug: string;
  stylistSlug: string;
  status: PairingStatus;
  pairedDaysAgo: number;
  /** true = para powstała ze zeskanowanego kodu QR (PairingSession claimed). */
  viaQr: boolean;
  revoked?: { daysAgo: number; by: AccountType };
  crmNote?: string;
  visits?: readonly DemoVisitSpec[];
  messages?: readonly DemoMessageSpec[];
  unreadFor?: 'CLIENT' | 'STYLIST' | null;
  likes?: readonly { photo: string; note: string | null }[];
  bookmark?: boolean;
  session?: DemoCommunitySessionSpec;
}

export const DEMO_COMMUNITY_PAIRS: readonly DemoCommunityPairSpec[] = [
  {
    clientSlug: 'hanna',
    stylistSlug: 'joanna',
    status: PairingStatusValue.ACTIVE,
    pairedDaysAgo: 40,
    viaQr: true,
    crmNote:
      'Lubi migdałowy kształt i odcienie nude. Ma cienką płytkę, bez frezowania przy skórkach.',
    visits: [
      { daysAgo: 35, serviceNoteIndex: 2, resultPhotoCount: 1 },
      { daysAgo: 12, serviceNoteIndex: 4, resultPhotoCount: 2 },
    ],
    messages: [
      {
        sender: 'STYLIST',
        content:
          'Hej Hania, dzięki za wizytę! Wrzuciłam zdjęcie efektu do Twojej karty.',
        hoursAgo: 70,
      },
      {
        sender: 'CLIENT',
        content: 'Wyszło pięknie, koleżanki pytały, gdzie robiłam.',
        hoursAgo: 50,
      },
      {
        sender: 'CLIENT',
        content:
          'Czy masz wolny termin w przyszły piątek po 17? Chciałabym coś na urodziny.',
        hoursAgo: 3,
      },
    ],
    unreadFor: 'STYLIST',
    likes: [
      { photo: 'nail-01', note: 'Taki kształt chcę na urodziny.' },
      { photo: 'nail-13-short-pastel', note: null },
    ],
    bookmark: true,
    session: {
      name: 'Na urodziny',
      state: SessionContainerLifecycleStateValue.READY,
      clientNote: 'Coś delikatnego, ale z błyskiem. Myślę o średniej długości.',
      photos: ['nail-01', 'nail-13-short-pastel', 'nail-24-medium-floral'],
    },
  },
  {
    clientSlug: 'hanna',
    stylistSlug: 'ania',
    status: PairingStatusValue.PENDING,
    pairedDaysAgo: 1,
    viaQr: false,
    messages: [
      {
        sender: 'CLIENT',
        content:
          'Dzień dobry, koleżanka poleciła mi Pani studio. Czy przyjmuje Pani nowe klientki w październiku?',
        hoursAgo: 20,
      },
    ],
    unreadFor: 'STYLIST',
    bookmark: true,
  },
  {
    clientSlug: 'oliwia',
    stylistSlug: 'ewelina',
    status: PairingStatusValue.ACTIVE,
    pairedDaysAgo: 25,
    viaQr: true,
    crmNote:
      'Pracuje przy komputerze, prosi o krótkie paznokcie. Reaguje na jeden z topów, używać bezkwasowego.',
    visits: [{ daysAgo: 21, serviceNoteIndex: 6, resultPhotoCount: 1 }],
    messages: [
      {
        sender: 'STYLIST',
        content:
          'Oliwia, pamiętaj o oliwce do skórek codziennie wieczorem, wtedy hybryda dłużej wytrzyma.',
        hoursAgo: 300,
      },
      {
        sender: 'CLIENT',
        content: 'Pamiętam, dziękuję! Trzyma się świetnie.',
        hoursAgo: 290,
      },
    ],
    unreadFor: null,
    likes: [
      { photo: 'hero-nail-03-geometric', note: 'Ten kolor na następny raz.' },
      { photo: 'hero-nail-05-floral', note: null },
    ],
    bookmark: true,
    session: {
      name: 'Manicure na wyjazd',
      state: SessionContainerLifecycleStateValue.EXPIRED,
      clientNote: 'Wyjeżdżam na dwa tygodnie, coś trwałego i neutralnego.',
      stylistNote:
        'Proponuję nude z cienką złotą linią, spokojnie zniesie plażę.',
      photos: ['hero-nail-01-nude', 'hero-nail-03-geometric'],
      sharedDaysAgo: 20,
    },
  },
  {
    clientSlug: 'oliwia',
    stylistSlug: 'ola',
    status: PairingStatusValue.PENDING,
    pairedDaysAgo: 3,
    viaQr: false,
    bookmark: true,
  },
  {
    clientSlug: 'weronika',
    stylistSlug: 'monika',
    status: PairingStatusValue.ACTIVE,
    pairedDaysAgo: 90,
    viaQr: true,
    crmNote:
      'Stała klientka co trzy tygodnie. Uwielbia długie migdały i ombre, zawsze kawa z mlekiem owsianym.',
    visits: [
      { daysAgo: 84, serviceNoteIndex: 7, resultPhotoCount: 2 },
      { daysAgo: 63, serviceNoteIndex: 11, resultPhotoCount: 1 },
      { daysAgo: 42, serviceNoteIndex: 5, resultPhotoCount: 2 },
      { daysAgo: 21, serviceNoteIndex: 1, resultPhotoCount: 1 },
    ],
    messages: [
      {
        sender: 'CLIENT',
        content: 'Moniko, czy możemy przesunąć środę na czwartek?',
        hoursAgo: 30,
      },
      {
        sender: 'STYLIST',
        content: 'Jasne, czwartek o 18 jest Twój.',
        hoursAgo: 26,
      },
    ],
    unreadFor: 'CLIENT',
    likes: [
      { photo: 'nail-08', note: null },
      { photo: 'nail-26-long-ombre', note: 'Ombre jak tutaj, tylko w bordo.' },
    ],
    bookmark: true,
    session: {
      name: 'Chrom na sylwestra',
      state: SessionContainerLifecycleStateValue.CLOSED,
      stylistNote: 'Zrobione: srebrny chrom na długich migdałach.',
      photos: ['nail-08', 'nail-03', 'nail-40-xl-pastel'],
      sharedDaysAgo: 30,
    },
  },
  {
    clientSlug: 'natalia',
    stylistSlug: 'agnieszka',
    status: PairingStatusValue.ACTIVE,
    pairedDaysAgo: 15,
    viaQr: true,
    crmNote:
      'Pierwsza wizyta po przeprowadzce do Katowic. Na jesień chce ciemne kolory.',
    visits: [{ daysAgo: 10, serviceNoteIndex: 1, resultPhotoCount: 1 }],
    messages: [
      {
        sender: 'STYLIST',
        content:
          'Natalia, dodałam nowe zdjęcia z kocim okiem, zerknij, czy coś Ci się podoba.',
        hoursAgo: 8,
      },
    ],
    unreadFor: 'CLIENT',
    likes: [
      {
        photo: 'nail-43-medium-cat-eye-rose-gold',
        note: 'To kocie oko jest cudne.',
      },
    ],
    bookmark: true,
  },
  {
    clientSlug: 'paulina',
    stylistSlug: 'sylwia',
    status: PairingStatusValue.REVOKED,
    pairedDaysAgo: 80,
    viaQr: true,
    revoked: { daysAgo: 20, by: AccountTypeValue.CLIENT },
    visits: [{ daysAgo: 70, serviceNoteIndex: 6, resultPhotoCount: 1 }],
    messages: [
      {
        sender: 'CLIENT',
        content:
          'Dziękuję za wszystkie wizyty! Przeprowadzam się do Warszawy, więc muszę poszukać kogoś na miejscu.',
        hoursAgo: 490,
      },
    ],
    unreadFor: null,
  },
  {
    clientSlug: 'zuzanna',
    stylistSlug: 'sylwia',
    status: PairingStatusValue.ACTIVE,
    pairedDaysAgo: 50,
    viaQr: true,
    crmNote:
      'Zapuszcza naturalne paznokcie. Tylko odżywka i french, bez wydłużania.',
    visits: [
      { daysAgo: 45, serviceNoteIndex: 2, resultPhotoCount: 1 },
      { daysAgo: 15, serviceNoteIndex: 10, resultPhotoCount: 1 },
    ],
    likes: [{ photo: 'nail-discover-01', note: null }],
    bookmark: true,
  },
  {
    // Para z S111 (istnieje); tu dochodzi wyłącznie wygasła sesja.
    clientSlug: 'zuzanna',
    stylistSlug: 'ania',
    status: PairingStatusValue.ACTIVE,
    pairedDaysAgo: 60,
    viaQr: false,
    session: {
      name: 'Kolory na wiosnę',
      state: SessionContainerLifecycleStateValue.EXPIRED,
      clientNote: 'Szukam pastelu, który nie będzie wyglądał dziecinnie.',
      stylistNote: 'Wybrałyśmy przygaszony róż, zapraszam w marcu.',
      photos: [
        'nail-17-medium-ombre',
        'hero-nail-05-floral',
        'nail-13-short-pastel',
      ],
      sharedDaysAgo: 40,
    },
  },
];

/** Zakładki i lajki bez pary: klientka ogląda profil, ale jeszcze się nie umówiła. */
export const DEMO_COMMUNITY_BROWSING: readonly {
  clientSlug: string;
  stylistSlug: string;
  likes: readonly { photo: string; note: string | null }[];
}[] = [
  { clientSlug: 'julia', stylistSlug: 'nina', likes: [] },
  {
    clientSlug: 'julia',
    stylistSlug: 'monika',
    likes: [{ photo: 'nail-03', note: 'Może kiedyś na wakacje w Łodzi.' }],
  },
  {
    clientSlug: 'magdalena',
    stylistSlug: 'agnieszka',
    likes: [
      { photo: 'hero-nail-06-ink-violet', note: null },
      { photo: 'nail-06', note: null },
    ],
  },
  { clientSlug: 'aleksandra', stylistSlug: 'joanna', likes: [] },
  {
    clientSlug: 'hanna',
    stylistSlug: 'nina',
    likes: [
      {
        photo: 'nail-48-short-classic-french',
        note: 'Idealny french do pracy.',
      },
    ],
  },
];
