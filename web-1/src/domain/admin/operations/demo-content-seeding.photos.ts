import {
  NailLengthValue,
  type NailLength,
} from '@kernel/models/db_models.generated.dto';

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
    asset_url: '/v3/demo-seed/portfolio-sample-024_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Złote'],
    traits: ['Zdobienia 3D', 'Wzorki'],
  },
  {
    asset_url: '/v3/demo-seed/portfolio-sample-032_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Brązowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url: '/v3/demo-seed/portfolio-sample-037_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Magnetyczne'],
  },
  {
    asset_url: '/v3/demo-seed/portfolio-sample-045_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Zdobienia 3D'],
  },
  {
    asset_url: '/v4/demo-seed/portfolio-sample-056_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Jednolite'],
  },
  {
    asset_url: '/v4/demo-seed/portfolio-sample-060_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v4/demo-seed/portfolio-sample-001_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Złote', 'Beżowe'],
    traits: ['French', 'Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v4/demo-seed/portfolio-sample-003_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['Ombre', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v5/demo-seed/portfolio-sample-005_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe', 'Szare'],
    traits: ['Chromowane', 'Zdobienia 3D'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v6/demo-seed/portfolio-sample-009_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Brązowe', 'Beżowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v7/demo-seed/portfolio-sample-018_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v7/demo-seed/portfolio-sample-020_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Zielone', 'Fioletowe'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v8/demo-seed/portfolio-sample-022_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Fioletowe', 'Zielone'],
    traits: ['French'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v9/demo-seed/portfolio-sample-028_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe'],
    traits: ['French', 'Perłowe', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v10/demo-seed/portfolio-sample-036_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Beżowe', 'Złote'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v10/demo-seed/portfolio-sample-039_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone', 'Czarne'],
    traits: ['Marble'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v11/demo-seed/portfolio-sample-042_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Czerwone'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v11/demo-seed/portfolio-sample-047_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Pomarańczowe', 'Różowe', 'Fioletowe'],
    traits: ['Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v13/demo-seed/portfolio-sample-069_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Różowe', 'Białe', 'Czarne'],
    traits: ['French', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v14/demo-seed/portfolio-sample-071_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Niebieskie', 'Złote'],
    traits: ['Jednolite', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v14/demo-seed/portfolio-sample-057_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Zielone'],
    traits: ['French', 'Magnetyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v14/demo-seed/portfolio-sample-012_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v16/demo-seed/portfolio-sample-061_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Turkusowe'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v16/demo-seed/portfolio-sample-013_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Białe'],
    traits: ['Jednolite'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v18/demo-seed/portfolio-sample-064_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Fioletowe'],
    traits: ['Chromowane', 'Wzorki'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v19/demo-seed/portfolio-sample-066_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Żółte'],
    traits: ['Florystyczne'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v17/demo-seed/portfolio-sample-015_rev2.webp',
    nail_length: NailLengthValue.SHORT,
    colors: ['Różowe', 'Białe'],
    traits: ['French'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v20/demo-seed/portfolio-sample-017_rev2.webp',
    nail_length: NailLengthValue.MEDIUM,
    colors: ['Białe', 'Szare'],
    traits: ['Chromowane'],
  },
  {
    asset_url:
      'https://res.cloudinary.com/example-cloud/image/upload/v22/demo-seed/portfolio-sample-068_rev2.webp',
    nail_length: NailLengthValue.LONG,
    colors: ['Różowe', 'Niebieskie'],
    traits: ['French', 'Florystyczne'],
  },
];
