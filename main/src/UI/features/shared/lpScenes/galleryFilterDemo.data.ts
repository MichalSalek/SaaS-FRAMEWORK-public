// UI/features/shared/lpScenes/galleryFilterDemo.data.ts
// The works of the playable gallery on public pages.
//
// DECISION: tags describe what the PHOTO shows, not its file name. Names in `LP_ASSETS.portfolio`
// are historical and mostly wrong („nail-44-short-cherry-red” is yellow nails on navy). Every
// assignment below was checked on a contact sheet; when swapping a photo, check the frame.

import { LP_ASSETS } from '../../../assets/lpAssets';

export const DEMO_TAGS = ['red', 'french', 'chrome', 'short'] as const;
export type DemoTag = (typeof DEMO_TAGS)[number];

export interface DemoWork {
  id: string;
  src: string;
  tags: readonly DemoTag[];
}

const { portfolio, hero } = LP_ASSETS;

export const DEMO_WORKS: readonly DemoWork[] = [
  // deep red almond on red satin
  { id: 'w01', src: portfolio.nail47MediumAuraBlush, tags: ['red'] },
  // nude with a gold french tip on marble
  { id: 'w02', src: portfolio.nail50LongBlackCherry, tags: ['french'] },
  // green chameleon chrome on dusty pink
  { id: 'w03', src: portfolio.nail21MediumRed, tags: ['chrome'] },
  // short pastel yellow on navy satin
  { id: 'w04', src: portfolio.nail44ShortCherryRed, tags: ['short'] },
  // burgundy cat eye
  { id: 'w05', src: hero.heroNail16VelvetCatEye, tags: ['red'] },
  // nude with a dark green french tip
  { id: 'w06', src: portfolio.nail42MediumSageMicroFrench, tags: ['french'] },
  // turquoise chrome on water glass
  { id: 'w07', src: portfolio.nail13ShortPastel, tags: ['chrome'] },
  // short tortoiseshell with a coffee cup
  { id: 'w08', src: portfolio.nail43MediumCatEyeRoseGold, tags: ['short'] },
  // cherry red with the bottle
  { id: 'w09', src: hero.heroNail18CherryBottle, tags: ['red', 'short'] },
  // champagne chrome on silk
  { id: 'w10', src: portfolio.nail52ChampagneChromeSilk, tags: ['chrome'] },
  // short milky nude on marble
  { id: 'w11', src: portfolio.nail09ShortNude, tags: ['short'] },
  // pearl white almond on white satin
  { id: 'w12', src: portfolio.nail48ShortClassicFrench, tags: ['chrome'] },
];
