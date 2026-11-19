import { NailLengthValue } from '@kernel/models/db_models.generated.dto';
import type { DemoPhoto } from './demo-content-seeding.photos';

/**
 * Gallery fixtures for the demonstration stylists Ola and Nina.
 * Each gallery uses distinct designs; provenance: demo-content-seeding.photos.ts.
 */

export const DEMO_PHOTOS_OLA: readonly DemoPhoto[] = [
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v5/demo-seed/portfolio-sample-006_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Złote'],
    traits: ['Zdobienia 3D', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v7/demo-seed/portfolio-sample-010_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['French', 'Perłowe', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v8/demo-seed/portfolio-sample-021_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Zielone'],
    traits: ['French', 'Magnetyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v12/demo-seed/portfolio-sample-048_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v13/demo-seed/portfolio-sample-070_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v15/demo-seed/portfolio-sample-058_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Brązowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v16/demo-seed/portfolio-sample-062_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v19/demo-seed/portfolio-sample-065_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v19/demo-seed/portfolio-sample-016_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone', 'Czarne'],
    traits: ['Marble'],
  },
];

export const DEMO_PHOTOS_NINA: readonly DemoPhoto[] = [
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v5/demo-seed/portfolio-sample-004_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v7/demo-seed/portfolio-sample-019_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v8/demo-seed/portfolio-sample-023_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v10/demo-seed/portfolio-sample-029_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Magnetyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v10/demo-seed/portfolio-sample-035_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Żółte'],
    traits: ['Florystyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v11/demo-seed/portfolio-sample-041_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['Ombre', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v13/demo-seed/portfolio-sample-055_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Złote'],
    traits: ['Zdobienia 3D', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v13/demo-seed/portfolio-sample-011_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Różowe', 'Niebieskie'],
    traits: ['French', 'Florystyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v16/demo-seed/portfolio-sample-059_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['French', 'Perłowe', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v18/demo-seed/portfolio-sample-063_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote', 'Beżowe'],
    traits: ['French', 'Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v18/demo-seed/portfolio-sample-014_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v21/demo-seed/portfolio-sample-067_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote'],
    traits: ['Chromowane', 'Wzorki'],
  },
];
