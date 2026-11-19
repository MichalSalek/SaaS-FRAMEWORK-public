import { BRAND_ACCENT_PALETTE } from '@kernel/domain/user-and-account/branding.config';

/** Synthetic gallery fixtures preserve the relationships between profiles, photos and sessions. */

/**
 * DECISION: no photo metadata here (nail_length, colors, traits). The gallery is built from
 * DEMO_PHOTOS_ANIA and only those values reach the DB; copies here were read by nobody and drifted from
 * the bank while looking like the source of truth. This type holds only what the bank does not know:
 * pinning and positions in demo sessions. Photo metadata goes in DEMO_PHOTOS_*.
 */
export interface DemoGalleryEntry {
  asset_url: string;
  is_pinned: boolean;
  /** Lajk demo-klientki: string = lajk z notka, null = lajk bez notki, undefined = brak */
  favorite_note?: string | null;
  /** Pozycja zdjecia w sesji SHARED ("Inspiracje na lipiec") */
  shared_session_position?: number;
  /** Pozycja zdjecia w sesji CLOSED ("Manicure slubny") */
  closed_session_position?: number;
}

type BrandAccentId = (typeof BRAND_ACCENT_PALETTE)[number]['id'];

/** Kolor akcentu z kuratorowanej palety kernela (walidator odrzuca inne wartości). */
export const brandHex = (id: BrandAccentId): string =>
  BRAND_ACCENT_PALETTE.find(c => c.id === id)?.hex ?? '';

export const CLOUDINARY_DEMO =
  'https://res.cloudinary.com/example-cloud/image/upload';

/**
 * DEMO_PHOTOS_ANIA/OLA/NINA (demo-content-seeding.photos*.ts) mix relative paths
 * ('/vNNN/demo-seed/plik.webp') and full URLs (already prefixed with CLOUDINARY_DEMO).
 * GalleryRecord.asset_url is always a full URL (rendering and the file-ownership
 * gate read res.cloudinary.com). Every bank value goes through this resolver, the
 * only normalization site, so one file never gets two rows (relative vs full)
 * in the find-or-create on asset_url.
 */
export const resolveDemoAssetUrl = (path: string): string =>
  path.startsWith('http') ? path : `${CLOUDINARY_DEMO}${path}`;

// DECISION: DEMO_GALLERY is the source of is_pinned and *_session_position for its own entries only;
// the gallery itself comes from DEMO_PHOTOS_ANIA (demo-content-seeding.photos.ts, a superset after
// resolveDemoAssetUrl). Pins and positions of other photos live in DEMO_PINNED_* and DEMO_SESSION_*
// below, so one photo is never split across two independent arrays.
export const DEMO_GALLERY: DemoGalleryEntry[] = [
  {
    asset_url: `${CLOUDINARY_DEMO}/v3/demo-seed/portfolio-sample-024_rev2.webp`,
    is_pinned: false,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v11/demo-seed/portfolio-sample-042_rev2.webp`,
    is_pinned: true,
    shared_session_position: 0,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v3/demo-seed/portfolio-sample-032_rev2.webp`,
    is_pinned: false,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v17/demo-seed/portfolio-sample-015_rev2.webp`,
    is_pinned: true,
    favorite_note: 'Idealne na co dzień. Pokazać Ani na następnej wizycie!',
    shared_session_position: 1,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v3/demo-seed/portfolio-sample-037_rev2.webp`,
    is_pinned: false,
    shared_session_position: 2,
    closed_session_position: 0,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v3/demo-seed/portfolio-sample-045_rev2.webp`,
    is_pinned: true,
    favorite_note: null,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-056_rev2.webp`,
    is_pinned: false,
    closed_session_position: 1,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-060_rev2.webp`,
    is_pinned: true,
    favorite_note: null,
  },
];

// ─── Profile stylistek ────────────────────────────────────────────────────

export const DEMO_STYLIST_PROFILE = {
  business_name: 'Studio Velvet Nails',
  address_city: 'Warszawa',
  instagram_handle: 'demo.velvet.nails',
  // Publiczny profil /stylist/velvet-nails (vanity @unique; smoke-stylistka ma 'test-studio')
  vanity_url: 'velvet-nails',
  phone: '+48 601 234 567',
  website: 'https://velvet-nails.example.com',
  brand_accent_color: brandHex('crimson'),
  description:
    'Specjalizuję się w delikatnych stylizacjach hybrydowych: french, ombre i ' +
    'minimalistyczne zdobienia. Pracuję na sterylnych narzędziach, w kameralnym ' +
    'studiu na Mokotowie. Portfolio aktualizuję po każdej ciekawszej wizycie.',
} as const;

export const STYLIST_OLA_PROFILE = {
  business_name: 'Ola Nails',
  address_city: 'Kraków',
  instagram_handle: 'demo.ola.nails',
  vanity_url: 'ola-nails',
  description:
    'Manicure hybrydowy i zdobienia w klimacie edytorialnym, zawsze z uwagą na ' +
    'zdrowie płytki. Umawiam się przez wiadomość, odpowiadam zwykle tego samego dnia.',
} as const;

export const STYLIST_NINA_PROFILE = {
  business_name: 'Atelier Nina',
  address_city: 'Gdańsk',
  instagram_handle: 'demo.atelier.nina',
  vanity_url: 'atelier-nina',
  brand_accent_color: brandHex('indigo'),
  description:
    'Atelier nastawione na precyzję: french w każdej odsłonie, chrom i perłowe ' +
    'wykończenia. Klientki umawiam z wyprzedzeniem, bo terminy szybko się zapełniają.',
} as const;

// ─── Personel salonu Ani (StaffMember, EMPLOYEE) ──────────────────────────

export const DEMO_SALON_STAFF = [
  {
    email: 'demo-staff-marta@example.com',
    display_name: 'Marta Zając',
  },
  {
    email: 'demo-staff-kasia@example.com',
    display_name: 'Kasia Lis',
  },
] as const;

/**
 * Ania's salon profile (Studio plan). The salon name is the business name on
 * her stylist profile: two different names read as two salons.
 * Without this config the stylist panel on LP screenshots shows
 * „Dokończ konfigurację salonu”. The showcase is Ania's pinned works from DEMO_GALLERY.
 */
export const DEMO_SALON_PROFILE = {
  salon_profile_name: DEMO_STYLIST_PROFILE.business_name,
  salon_vanity_url: 'studio-velvet-nails',
  salon_brand_accent_color: brandHex('rosewood'),
  /** Pierwsze trzy przypięte prace z DEMO_GALLERY (bez drugiej listy adresów). */
  showcase_asset_urls: DEMO_GALLERY.filter(entry => entry.is_pinned)
    .slice(0, 3)
    .map(entry => entry.asset_url),
} as const;

// ─── Piny poza DEMO_GALLERY (asset_url z banków DEMO_PHOTOS_*) ────────────

export const DEMO_PINNED_ANIA_EXTRA: readonly string[] = [
  `${CLOUDINARY_DEMO}/v10/demo-seed/portfolio-sample-036_rev2.webp`,
  `${CLOUDINARY_DEMO}/v20/demo-seed/portfolio-sample-017_rev2.webp`,
];

export const DEMO_PINNED_OLA: readonly string[] = [
  `${CLOUDINARY_DEMO}/v19/demo-seed/portfolio-sample-016_rev2.webp`,
  `${CLOUDINARY_DEMO}/v7/demo-seed/portfolio-sample-010_rev2.webp`,
  `${CLOUDINARY_DEMO}/v12/demo-seed/portfolio-sample-048_rev2.webp`,
];

export const DEMO_PINNED_NINA: readonly string[] = [
  `${CLOUDINARY_DEMO}/v18/demo-seed/portfolio-sample-063_rev2.webp`,
  `${CLOUDINARY_DEMO}/v13/demo-seed/portfolio-sample-011_rev2.webp`,
  `${CLOUDINARY_DEMO}/v21/demo-seed/portfolio-sample-067_rev2.webp`,
];

// ─── Sesje Ani (zdjęcia spoza DEMO_GALLERY) ───────────────────────────────

export const DEMO_SESSION_SHARED = {
  name: 'Inspiracje na lipiec',
  client_note:
    'Najbardziej podobają mi się te jaśniejsze odcienie i french. Co myślisz o perłowym wykończeniu?',
  stylist_note:
    'Zrobiłabym french z perłowym topem. Przyniosę próbki na wizytę, a długość zostawimy średnią.',
} as const;

/** Fourth photo of the SHARED session. Added to the three DEMO_GALLERY positions (0, 1, 2). */
export const DEMO_SESSION_SHARED_EXTRA_PHOTO = `${CLOUDINARY_DEMO}/v3/demo-seed/portfolio-sample-032_rev2.webp`;

export const DEMO_SESSION_CLOSED = {
  name: 'Manicure ślubny',
  stylist_note: 'Manicure zrobiony na podstawie wybranych zdjęć.',
} as const;

/** Third photo of the CLOSED session. Added to the two DEMO_GALLERY positions (0, 1). */
export const DEMO_SESSION_CLOSED_EXTRA_PHOTO = `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-060_rev2.webp`;

export const DEMO_SESSION_DRAFT_NAME = 'Pomysły na jesień';

/** Four photos attached to the DRAFT session, the same ones Karolina likes with a note. */
export const DEMO_SESSION_DRAFT_PHOTOS: readonly {
  asset_url: string;
  favorite_note: string;
}[] = [
  {
    asset_url: `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-003_rev2.webp`,
    favorite_note:
      'Świetny wzór na jesienny wieczór, chcę spróbować czegoś podobnego.',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v4/demo-seed/portfolio-sample-060_rev2.webp`,
    favorite_note: 'Podoba mi się chrom i złote wzorki. Chcę podobny efekt.',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v3/demo-seed/portfolio-sample-024_rev2.webp`,
    favorite_note: 'Klasyk na co dzień, zawsze się sprawdza.',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v10/demo-seed/portfolio-sample-039_rev2.webp`,
    favorite_note:
      'Podoba mi się wiśniowy marmurkowy wzór. Chcę podobny na następnej wizycie.',
  },
];

/** Dwa dodatkowe lajki Karoliny na galerii Ani, z notką (pinowane zdjęcia). */
export const DEMO_KAROLINA_EXTRA_ANIA_LIKES: readonly {
  asset_url: string;
  favorite_note: string;
}[] = [
  {
    asset_url: `${CLOUDINARY_DEMO}/v10/demo-seed/portfolio-sample-036_rev2.webp`,
    favorite_note: 'Czerwień jak dla mnie, może na Sylwestra?',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v11/demo-seed/portfolio-sample-042_rev2.webp`,
    favorite_note: 'Podoba mi się burgundowy kolor i metaliczne wykończenie.',
  },
];

export const DEMO_SESSION_OLA = {
  name: 'Na wesele siostry',
  client_note:
    'Chciałabym coś eleganckiego, ale bez zbyt dużej ilości bieli, bo to nie ja jestem panną młodą.',
  stylist_note:
    'Może delikatny beż z odrobiną perłowego brokatu na serdecznym palcu? Na wizycie sprawdzimy, jak wygląda z sukienką.',
} as const;

/**
 * Exact session notes (client and stylist, every demo session, including new
 * clients from `DEMO_NEW_CLIENTS`) that the seed no longer uses. Notes are
 * written only when the session is created, so an existing session that still
 * has one of these sentences is rewritten from its spec on the next seed
 * (`refreshRetiredSessionNotes_IO`).
 */
export const RETIRED_SESSION_NOTES: readonly string[] = [
  'Najbardziej podobają mi się te jaśniejsze odcienie, mam słabość do frenchu. Co myślisz o perłowym wykończeniu?',
  'Proponuję french z perłowym topem, przyniosę próbki na wizytę. Długość zostawiamy średnią.',
  'Zrealizowane: manicure inspirowany wybranymi zdjęciami. Do zobaczenia!',
  'Szukam czegoś eleganckiego, ale nie za bardzo białego, bo to nie ja będę panną młodą.',
  'Zaproponuję delikatny beż z odrobiną perłowego brokatu na serdecznym, będzie pasować do każdej sukienki.',
  'Proponuję delikatny beż i odrobinę perłowego brokatu na serdecznym palcu. Będzie pasować do każdej sukienki.',
  'Proponuję nude z cienką złotą linią, spokojnie zniesie plażę.',
  'Szukam czegoś delikatnego, ale z odrobiną błysku na tę okazję.',
  'Marzy mi się coś ze złotem, tak jak lubię. Co polecasz?',
] as const;

export const DEMO_SESSION_OLA_PHOTOS: readonly string[] = [
  `${CLOUDINARY_DEMO}/v7/demo-seed/portfolio-sample-010_rev2.webp`,
  `${CLOUDINARY_DEMO}/v8/demo-seed/portfolio-sample-021_rev2.webp`,
  `${CLOUDINARY_DEMO}/v16/demo-seed/portfolio-sample-062_rev2.webp`,
];

// ─── Lajki Karoliny u Oli i Niny (bez notek) ──────────────────────────────

export const DEMO_KAROLINA_OLA_LIKES: readonly string[] = [
  `${CLOUDINARY_DEMO}/v8/demo-seed/portfolio-sample-021_rev2.webp`,
  `${CLOUDINARY_DEMO}/v16/demo-seed/portfolio-sample-062_rev2.webp`,
  `${CLOUDINARY_DEMO}/v15/demo-seed/portfolio-sample-058_rev2.webp`,
];

export const DEMO_KAROLINA_NINA_LIKES: readonly string[] = [
  `${CLOUDINARY_DEMO}/v7/demo-seed/portfolio-sample-019_rev2.webp`,
  `${CLOUDINARY_DEMO}/v16/demo-seed/portfolio-sample-059_rev2.webp`,
  `${CLOUDINARY_DEMO}/v10/demo-seed/portfolio-sample-029_rev2.webp`,
];

export const DEMO_SUPPORT_THREAD = {
  subject: 'Jak dodać zdjęcie do sesji?',
  user_message:
    'Cześć! Mam sparowaną stylistkę i chciałabym dorzucić zdjęcie z jej galerii do mojej sesji. Gdzie to się robi?',
  support_reply:
    'Cześć, Karolina! Otwórz sesję i wybierz „Dodaj inspiracje z galerii”. Wybierz prace swojej stylistki, które chcesz pokazać przed wizytą.',
  /** Exact old seed reply used to refresh only this known demo message on re-seed. */
  retired_support_reply:
    'Cześć Karolina! Wejdź w sesję, a potem w „Dodaj z galerii”, a otworzy się galeria Twojej stylistki i przy każdym zdjęciu zobaczysz przycisk dodania. Daj znać, czy działa!',
} as const;
