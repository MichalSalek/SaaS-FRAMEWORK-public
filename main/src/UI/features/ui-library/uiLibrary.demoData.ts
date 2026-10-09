import type { AppBarLink } from '../../components/AppBar/AppBar.organism';

/** Dane pokazowe dla renderów w /dev/ui (kotwice prowadzą do sekcji strony). */

export const APP_BAR_DEMO_LINKS: AppBarLink[] = [
  {
    label: 'Dla stylistek',
    href: '#app-organisms',
    hint: 'Portfolio i historia klientek',
  },
  {
    label: 'Dla klientek',
    href: '#utility',
    hint: 'Inspiracje przed wizytą',
  },
  {
    label: 'Cennik',
    href: '#label-family',
    hint: 'Plany i porównanie',
  },
];
