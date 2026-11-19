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
 * Relations for the demo showcase community layer: two newer clients, pairs in
 * every status (ACTIVE via QR, PENDING, REVOKED), messages, visits, likes,
 * bookmarks and sessions the first showcase did not cover (READY, EXPIRED,
 * CLOSED outside Ania). Photo rules: demo-content-seeding.community-stylists-data.ts.
 * Client slugs: 'karolina' (DEMO_CLIENT), DEMO_NEW_CLIENTS, or
 * DEMO_COMMUNITY_CLIENTS below. Stylist slugs: 'ania' | 'ola' | 'nina' or
 * DEMO_COMMUNITY_STYLISTS. `photo` is a bank file name (no Cloudinary suffix)
 * and must belong to this stylist's gallery, so a like and a session always
 * hit her own work (demo-content-seeding.data.test.ts checks that).
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
  /** EXPIRED/CLOSED: when the session was shared (share window, SESSION_EXPIRY_DAYS, counted from this date). */
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
      { photo: 'portfolio-sample-018', note: 'Taki kształt chcę na urodziny.' },
      { photo: 'portfolio-sample-028', note: null },
    ],
    bookmark: true,
    session: {
      name: 'Na urodziny',
      state: SessionContainerLifecycleStateValue.READY,
      clientNote: 'Coś delikatnego, ale z błyskiem. Myślę o średniej długości.',
      photos: [
        'portfolio-sample-018',
        'portfolio-sample-028',
        'portfolio-sample-039',
      ],
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
      { photo: 'portfolio-sample-003', note: 'Ten kolor na następny raz.' },
      { photo: 'portfolio-sample-005', note: null },
    ],
    bookmark: true,
    session: {
      name: 'Manicure na wyjazd',
      state: SessionContainerLifecycleStateValue.EXPIRED,
      clientNote: 'Wyjeżdżam na dwa tygodnie, coś trwałego i neutralnego.',
      stylistNote:
        'Proponuję nude z cienką złotą linią. To spokojna propozycja na wyjazd.',
      photos: ['portfolio-sample-001', 'portfolio-sample-003'],
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
      { photo: 'portfolio-sample-023', note: null },
      {
        photo: 'portfolio-sample-041',
        note: 'Ombre jak tutaj, tylko w bordo.',
      },
    ],
    bookmark: true,
    session: {
      name: 'Chrom na sylwestra',
      state: SessionContainerLifecycleStateValue.CLOSED,
      stylistNote: 'Zrobione: srebrny chrom na długich migdałach.',
      photos: [
        'portfolio-sample-023',
        'portfolio-sample-019',
        'portfolio-sample-055',
      ],
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
        photo: 'portfolio-sample-058',
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
    likes: [{ photo: 'portfolio-sample-069', note: null }],
    bookmark: true,
  },
  {
    // The pair already exists from the first showcase; only an expired session is added here.
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
        'portfolio-sample-032',
        'portfolio-sample-005',
        'portfolio-sample-028',
      ],
      sharedDaysAgo: 40,
    },
  },
];

/** Bookmarks and likes with no pair: the client views the profile and has not booked yet. */
export const DEMO_COMMUNITY_BROWSING: readonly {
  clientSlug: string;
  stylistSlug: string;
  likes: readonly { photo: string; note: string | null }[];
}[] = [
  { clientSlug: 'julia', stylistSlug: 'nina', likes: [] },
  {
    clientSlug: 'julia',
    stylistSlug: 'monika',
    likes: [
      {
        photo: 'portfolio-sample-019',
        note: 'Może kiedyś na wakacje w Łodzi.',
      },
    ],
  },
  {
    clientSlug: 'magdalena',
    stylistSlug: 'agnieszka',
    likes: [
      { photo: 'portfolio-sample-006', note: null },
      { photo: 'portfolio-sample-021', note: null },
    ],
  },
  { clientSlug: 'aleksandra', stylistSlug: 'joanna', likes: [] },
  {
    clientSlug: 'hanna',
    stylistSlug: 'nina',
    likes: [
      {
        photo: 'portfolio-sample-063',
        note: 'Idealny french do pracy.',
      },
    ],
  },
];
