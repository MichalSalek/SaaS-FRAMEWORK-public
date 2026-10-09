import {
  NailLengthValue,
  type NailLength,
} from '@kernel/models/db_models.generated.dto';

/**
 * Development-only gallery bank refreshed with the owner-reviewed 2026-10-08 glamour photos.
 * Sources are LP assets and main/public/img/demo/glamour; their briefs live in
 * docs/DOMAIN/marketing/LP_DEMO_GLAMOUR_IMAGE_BRIEFS_2026-10-07.json.
 * Uploads belong to the development cloud dcuiuwkb0, folder demo-seed.
 * Historical filename stems are stable aliases used by session/client fixtures;
 * actual length, colors and traits describe the new images, not those aliases.
 * Each stylist gallery and client favorites collection has distinct source bytes.
 * Accepted source bytes are frozen; one new cobalt photograph is an owner-review candidate.
 * The 29-design source bank can be reused across separate demonstration accounts.
 *
 * 2026-09-16: owner wycofał 21 plików z wystawy. NIE dopisywać ich z powrotem;
 * lista i sprzątanie istniejących wierszy: demo-content-seeding.cleanup.ts.
 */

export interface DemoPhoto {
  asset_url: string;
  nail_length: NailLength;
  /** Nazwy z COLOR_SEED_DATA (lookup po Color.name) */
  colors: readonly string[];
  /** Nazwy z TRAIT_SEED_DATA (lookup po Trait.name) */
  traits: readonly string[];
}

export const DEMO_PHOTOS_ANIA: readonly DemoPhoto[] = [
  {
    asset_url: '/v1791414182/demo-seed/nail-09-short-nude_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Złote'],
    traits: ['Zdobienia 3D', 'Wzorki'],
  },
  {
    asset_url:
      '/v1791414182/demo-seed/nail-17-medium-ombre_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Brązowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      '/v1791414182/demo-seed/nail-22-medium-wedding_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Magnetyczne'],
  },
  {
    asset_url: '/v1791414182/demo-seed/nail-30-long-floral_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Zdobienia 3D'],
  },
  {
    asset_url:
      '/v1791414184/demo-seed/nail-41-medium-baby-boomer_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      '/v1791414184/demo-seed/nail-45-long-champagne-chrome_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414184/demo-seed/hero-nail-01-nude_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote', 'Beżowe'],
    traits: ['French', 'Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414184/demo-seed/hero-nail-03-geometric_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['Ombre', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414185/demo-seed/hero-nail-05-floral_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe', 'Szare'],
    traits: ['Chromowane', 'Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414186/demo-seed/hero-nail-09-dark-editorial_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Brązowe', 'Beżowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414187/demo-seed/nail-01_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414187/demo-seed/nail-05_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Zielone', 'Fioletowe'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414189/demo-seed/nail-07_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Fioletowe', 'Zielone'],
    traits: ['French'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414190/demo-seed/nail-13-short-pastel_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['French', 'Perłowe', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414191/demo-seed/nail-21-medium-red_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Beżowe', 'Złote'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414191/demo-seed/nail-24-medium-floral_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone', 'Czarne'],
    traits: ['Marble'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414192/demo-seed/nail-27-long-french_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414192/demo-seed/nail-32-long-minimal-line_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Pomarańczowe', 'Różowe', 'Fioletowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414194/demo-seed/nail-discover-01_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe', 'Białe', 'Czarne'],
    traits: ['French', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414196/demo-seed/nail-discover-03_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Niebieskie', 'Złote'],
    traits: ['Jednolite', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414196/demo-seed/nail-42-medium-sage-micro-french_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Zielone'],
    traits: ['French', 'Magnetyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414196/demo-seed/hero-nail-14-bridal-milky-white_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414198/demo-seed/nail-46-medium-tortoiseshell_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Turkusowe'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414198/demo-seed/hero-nail-15-dark-chocolate_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414200/demo-seed/nail-49-medium-marble-accent_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414201/demo-seed/nail-51-medium-3d-gel-droplets_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Żółte'],
    traits: ['Florystyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414199/demo-seed/hero-nail-17-glazed-knit_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Różowe', 'Białe'],
    traits: ['French'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414202/demo-seed/hero-nail-19-molten-french_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Szare'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414204/demo-seed/nail-53-jelly-oil-droplet_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Różowe', 'Niebieskie'],
    traits: ['French', 'Florystyczne'],
  },
];
