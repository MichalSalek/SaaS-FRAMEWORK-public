import type { TraitCategory } from '../../models/db_models.manual.dto';

export type ColorSeedData = {
  name: string;
  hex_code: string;
  display_order: number;
};

export type TraitSeedData = {
  name: string;
  category: TraitCategory;
  display_order: number;
  is_featured: boolean;
};

export const COLOR_SEED_DATA: readonly ColorSeedData[] = [
  { name: 'Białe', hex_code: '#ffffff', display_order: 1 },
  { name: 'Czarne', hex_code: '#000000', display_order: 2 },
  { name: 'Szare', hex_code: '#808080', display_order: 3 },
  { name: 'Czerwone', hex_code: '#ff0000', display_order: 4 },
  { name: 'Pomarańczowe', hex_code: '#ffa500', display_order: 5 },
  { name: 'Żółte', hex_code: '#ffff00', display_order: 6 },
  { name: 'Zielone', hex_code: '#008000', display_order: 7 },
  { name: 'Turkusowe', hex_code: '#40e0d0', display_order: 8 },
  { name: 'Niebieskie', hex_code: '#007bff', display_order: 9 },
  { name: 'Fioletowe', hex_code: '#800080', display_order: 10 },
  { name: 'Różowe', hex_code: '#ff69b4', display_order: 11 },
  { name: 'Beżowe', hex_code: '#f5f5dc', display_order: 12 },
  { name: 'Brązowe', hex_code: '#8b4513', display_order: 13 },
  { name: 'Złote', hex_code: '#d4af37', display_order: 14 },
] as const;

export const TRAIT_SEED_DATA: readonly TraitSeedData[] = [
  // technique — wzór/pattern bazowy
  {
    name: 'Jednolite',
    category: 'technique',
    display_order: 1,
    is_featured: false,
  },
  {
    name: 'French',
    category: 'technique',
    display_order: 2,
    is_featured: false,
  },
  {
    name: 'Ombre',
    category: 'technique',
    display_order: 3,
    is_featured: false,
  },
  {
    name: 'Baby Boomer',
    category: 'technique',
    display_order: 4,
    is_featured: false,
  },
  {
    name: 'Marble',
    category: 'technique',
    display_order: 5,
    is_featured: false,
  },
  {
    name: 'Wzorki',
    category: 'technique',
    display_order: 6,
    is_featured: false,
  },

  // finish — efekt powierzchni
  { name: 'Matowe', category: 'finish', display_order: 1, is_featured: false },
  {
    name: 'Chromowane',
    category: 'finish',
    display_order: 2,
    is_featured: false,
  },
  { name: 'Perłowe', category: 'finish', display_order: 3, is_featured: false },
  {
    name: 'Holograficzne',
    category: 'finish',
    display_order: 4,
    is_featured: false,
  },
  {
    name: 'Magnetyczne',
    category: 'finish',
    display_order: 5,
    is_featured: false,
  },
  {
    name: 'Brokatowe',
    category: 'finish',
    display_order: 6,
    is_featured: false,
  },

  // decoration — elementy na wierzchu
  {
    name: 'Cyrkonie',
    category: 'decoration',
    display_order: 1,
    is_featured: false,
  },
  {
    name: 'Zdobienia 3D',
    category: 'decoration',
    display_order: 2,
    is_featured: false,
  },
  {
    name: 'Folia',
    category: 'decoration',
    display_order: 3,
    is_featured: false,
  },

  // style — motyw wizualny
  {
    name: 'Minimalistyczne',
    category: 'style',
    display_order: 1,
    is_featured: false,
  },
  {
    name: 'Florystyczne',
    category: 'style',
    display_order: 2,
    is_featured: false,
  },
  {
    name: 'Artystyczne',
    category: 'style',
    display_order: 3,
    is_featured: false,
  },
] as const;
