import { NailLengthValue } from '@kernel/models/db_models.generated.dto';
import type { DemoPhoto } from './demo-content-seeding.photos';

/**
 * Gallery fixtures for the demonstration stylists Ola and Nina.
 * Each gallery uses distinct designs; provenance: demo-content-seeding.photos.ts.
 */

export const DEMO_PHOTOS_OLA: readonly DemoPhoto[] = [
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414185/demo-seed/hero-nail-06-ink-violet_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Złote'],
    traits: ['Zdobienia 3D', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414187/demo-seed/hero-nail-10-bridal-floral_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['French', 'Perłowe', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414189/demo-seed/nail-06_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Zielone'],
    traits: ['French', 'Magnetyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414193/demo-seed/nail-33-xl-dark-editorial_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414194/demo-seed/nail-discover-02_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414197/demo-seed/nail-43-medium-cat-eye-rose-gold_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Brązowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414198/demo-seed/nail-47-medium-aura-blush_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414201/demo-seed/nail-50-long-black-cherry_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414201/demo-seed/hero-nail-18-cherry-bottle_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone', 'Czarne'],
    traits: ['Marble'],
  },
];

export const DEMO_PHOTOS_NINA: readonly DemoPhoto[] = [
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414185/demo-seed/hero-nail-04-ombre_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414187/demo-seed/nail-03_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414189/demo-seed/nail-08_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414191/demo-seed/nail-14-short-glitter_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Magnetyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414191/demo-seed/nail-20-medium-geometric_review20261008.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Żółte'],
    traits: ['Florystyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414192/demo-seed/nail-26-long-ombre_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['Ombre', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414194/demo-seed/nail-40-xl-pastel_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Złote'],
    traits: ['Zdobienia 3D', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414194/demo-seed/hero-nail-12-pearl-chrome-portrait_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Różowe', 'Niebieskie'],
    traits: ['French', 'Florystyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414198/demo-seed/nail-44-short-cherry-red_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['French', 'Perłowe', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414200/demo-seed/nail-48-short-classic-french_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote', 'Beżowe'],
    traits: ['French', 'Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414200/demo-seed/hero-nail-16-velvet-cat-eye_review20261008.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/dcuiuwkb0/image/upload/v1791414203/demo-seed/nail-52-champagne-chrome-silk_review20261008.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote'],
    traits: ['Chromowane', 'Wzorki'],
  },
];
