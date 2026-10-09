import { BRAND_ACCENT_PALETTE } from '@kernel/domain/user-and-account/branding.config';

/**
 * Konfiguracja demo-contentu (wystawa na kontach demo-*) — dane dla
 * demo-content-seeding.operations.ts i towarzyszących mu plików. Patrz DECISION
 * w demo-content-seeding.operations.ts.
 *
 * Zdjecia: realne URL-e Cloudinary (folder demo-seed) — ta sama sciezka renderowania
 * co produkcyjny upload (getCloudinaryThumbUrl robi transformacje tylko dla
 * res.cloudinary.com).
 */

/**
 * DECISION (nie usuwaj tego komentarza) — TU NIE MA METADANYCH ZDJECIA:
 * wpis niosl kiedys rowniez `nail_length`, `colors` i `traits`, ale galeria jest
 * budowana z DEMO_PHOTOS_ANIA i to TAMTE wartosci trafialy do bazy — te nie byly
 * czytane przez nikogo. Cztery z osmiu wpisow zdazyly sie przez to rozjechac ze
 * swoim odpowiednikiem w banku (inne kolory przy tym samym pliku), czyli stala
 * wygladala na zrodlo prawdy, nie bedac nim. Ta struktura opisuje WYLACZNIE to,
 * czego bank nie wie: przypiecie i pozycje w sesjach demo. Metadane zdjecia
 * dokladasz w DEMO_PHOTOS_* — jedyne miejsce, z ktorego seed je zapisuje.
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
  'https://res.cloudinary.com/dcuiuwkb0/image/upload';

/**
 * DEMO_PHOTOS_ANIA/OLA/NINA (banki zdjęć, patrz demo-content-seeding.photos*.ts)
 * mieszają relatywne ścieżki ('/vNNN/demo-seed/plik.webp') i pełne URL-e
 * (już z prefiksem CLOUDINARY_DEMO). GalleryRecord.asset_url musi być zawsze
 * pełnym URL-em (renderowanie + bramka własności pliku czytają res.cloudinary.com),
 * więc KAŻDE użycie wartości z banku zdjęć przechodzi przez ten resolver — jedyne
 * miejsce normalizacji, żeby ten sam plik nigdy nie dostał dwóch różnych wierszy
 * (relatywny vs pełny) w find-or-create po asset_url.
 */
export const resolveDemoAssetUrl = (path: string): string =>
  path.startsWith('http') ? path : `${CLOUDINARY_DEMO}${path}`;

// DECISION (nie usuwaj tego komentarza) — S111 (2026-09-14): DEMO_GALLERY (8 wpisów)
// pozostaje jedynym źródłem prawdy dla is_pinned/*_session_position TYLKO dla
// swoich wpisów — galeria sama w sobie jest budowana z DEMO_PHOTOS_ANIA
// (demo-content-seeding.photos.ts), bo ten bank jest nadzbiorem tych URL-i (po
// normalizacji resolveDemoAssetUrl). Piny i pozycje sesji dla pozostałych zdjęć
// żyją w osobnych stałych niżej (DEMO_PINNED_*, DEMO_SESSION_*_PHOTOS), żeby nie
// rozjeżdżać jednego zdjęcia pomiędzy dwoma niezależnymi tablicami danych.
// 2026-09-16: 21 plików usuniętych decyzją ownera (lista i sprzątanie:
// demo-content-seeding.cleanup.ts) zastąpione pracami w podobnym stylu z banku.
export const DEMO_GALLERY: DemoGalleryEntry[] = [
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414182/demo-seed/nail-09-short-nude_review20261008.webp`,
    is_pinned: false,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414192/demo-seed/nail-27-long-french_review20261008.webp`,
    is_pinned: true,
    shared_session_position: 0,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414182/demo-seed/nail-17-medium-ombre_review20261008.webp`,
    is_pinned: false,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414199/demo-seed/hero-nail-17-glazed-knit_review20261008.webp`,
    is_pinned: true,
    favorite_note: 'Idealne na co dzień. Pokazać Ani na następnej wizycie!',
    shared_session_position: 1,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414182/demo-seed/nail-22-medium-wedding_review20261008.webp`,
    is_pinned: false,
    shared_session_position: 2,
    closed_session_position: 0,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414182/demo-seed/nail-30-long-floral_review20261008.webp`,
    is_pinned: true,
    favorite_note: null,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414184/demo-seed/nail-41-medium-baby-boomer_review20261008.webp`,
    is_pinned: false,
    closed_session_position: 1,
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414184/demo-seed/nail-45-long-champagne-chrome_review20261008.webp`,
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
  website: 'velvet-nails.example.com',
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

// ─── Piny poza DEMO_GALLERY (asset_url z banków DEMO_PHOTOS_*) ────────────

export const DEMO_PINNED_ANIA_EXTRA: readonly string[] = [
  `${CLOUDINARY_DEMO}/v1791414191/demo-seed/nail-21-medium-red_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414202/demo-seed/hero-nail-19-molten-french_review20261008.webp`,
];

export const DEMO_PINNED_OLA: readonly string[] = [
  `${CLOUDINARY_DEMO}/v1791414201/demo-seed/hero-nail-18-cherry-bottle_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414187/demo-seed/hero-nail-10-bridal-floral_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414193/demo-seed/nail-33-xl-dark-editorial_review20261008.webp`,
];

export const DEMO_PINNED_NINA: readonly string[] = [
  `${CLOUDINARY_DEMO}/v1791414200/demo-seed/nail-48-short-classic-french_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414194/demo-seed/hero-nail-12-pearl-chrome-portrait_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414203/demo-seed/nail-52-champagne-chrome-silk_review20261008.webp`,
];

// ─── Sesje Ani (zdjęcia spoza DEMO_GALLERY) ───────────────────────────────

export const DEMO_SESSION_SHARED = {
  name: 'Inspiracje na lipiec',
  client_note:
    'Najbardziej podobają mi się te jaśniejsze odcienie, mam słabość do frenchu. Co myślisz o perłowym wykończeniu?',
  stylist_note:
    'Proponuję french z perłowym topem, przyniosę próbki na wizytę. Długość zostawiamy średnią.',
} as const;

/** 4. zdjęcie sesji SHARED — dokłada się do 3 pozycji z DEMO_GALLERY (0,1,2). */
export const DEMO_SESSION_SHARED_EXTRA_PHOTO = `${CLOUDINARY_DEMO}/v1791414182/demo-seed/nail-17-medium-ombre_review20261008.webp`;

export const DEMO_SESSION_CLOSED = {
  name: 'Manicure ślubny',
  stylist_note:
    'Zrealizowane: manicure inspirowany wybranymi zdjęciami. Do zobaczenia!',
} as const;

/** 3. zdjęcie sesji CLOSED — dokłada się do 2 pozycji z DEMO_GALLERY (0,1). */
export const DEMO_SESSION_CLOSED_EXTRA_PHOTO = `${CLOUDINARY_DEMO}/v1791414184/demo-seed/nail-45-long-champagne-chrome_review20261008.webp`;

export const DEMO_SESSION_DRAFT_NAME = 'Pomysły na jesień';

/** 4 zdjęcia dopięte do sesji DRAFT — te same, które Karolina lajkuje z notką. */
export const DEMO_SESSION_DRAFT_PHOTOS: readonly {
  asset_url: string;
  favorite_note: string;
}[] = [
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414184/demo-seed/hero-nail-03-geometric_review20261008.webp`,
    favorite_note:
      'Świetny wzór na jesienny wieczór, chcę spróbować czegoś podobnego.',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414184/demo-seed/nail-45-long-champagne-chrome_review20261008.webp`,
    favorite_note: 'Podoba mi się chrom i złote wzorki. Chcę podobny efekt.',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414182/demo-seed/nail-09-short-nude_review20261008.webp`,
    favorite_note: 'Klasyk na co dzień, zawsze się sprawdza.',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414191/demo-seed/nail-24-medium-floral_review20261008.webp`,
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
    asset_url: `${CLOUDINARY_DEMO}/v1791414191/demo-seed/nail-21-medium-red_review20261008.webp`,
    favorite_note: 'Czerwień jak dla mnie, może na Sylwestra?',
  },
  {
    asset_url: `${CLOUDINARY_DEMO}/v1791414192/demo-seed/nail-27-long-french_review20261008.webp`,
    favorite_note: 'Podoba mi się burgundowy kolor i metaliczne wykończenie.',
  },
];

export const DEMO_SESSION_OLA = {
  name: 'Na wesele siostry',
  client_note:
    'Szukam czegoś eleganckiego, ale nie za bardzo białego, bo to nie ja będę panną młodą.',
  stylist_note:
    'Zaproponuję delikatny beż z odrobiną perłowego brokatu na serdecznym, będzie pasować do każdej sukienki.',
} as const;

export const DEMO_SESSION_OLA_PHOTOS: readonly string[] = [
  `${CLOUDINARY_DEMO}/v1791414187/demo-seed/hero-nail-10-bridal-floral_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414189/demo-seed/nail-06_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414198/demo-seed/nail-47-medium-aura-blush_review20261008.webp`,
];

// ─── Lajki Karoliny u Oli i Niny (bez notek) ──────────────────────────────

export const DEMO_KAROLINA_OLA_LIKES: readonly string[] = [
  `${CLOUDINARY_DEMO}/v1791414189/demo-seed/nail-06_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414198/demo-seed/nail-47-medium-aura-blush_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414197/demo-seed/nail-43-medium-cat-eye-rose-gold_review20261008.webp`,
];

export const DEMO_KAROLINA_NINA_LIKES: readonly string[] = [
  `${CLOUDINARY_DEMO}/v1791414187/demo-seed/nail-03_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414198/demo-seed/nail-44-short-cherry-red_review20261008.webp`,
  `${CLOUDINARY_DEMO}/v1791414191/demo-seed/nail-14-short-glitter_review20261008.webp`,
];

export const DEMO_SUPPORT_THREAD = {
  subject: 'Jak dodać zdjęcie do sesji?',
  user_message:
    'Cześć! Mam sparowaną stylistkę i chciałabym dorzucić zdjęcie z jej galerii do mojej sesji. Gdzie to się robi?',
  support_reply:
    'Cześć Karolina! Wejdź w sesję, a potem w „Dodaj z galerii”, a otworzy się galeria Twojej stylistki i przy każdym zdjęciu zobaczysz przycisk dodania. Daj znać, czy działa!',
} as const;
