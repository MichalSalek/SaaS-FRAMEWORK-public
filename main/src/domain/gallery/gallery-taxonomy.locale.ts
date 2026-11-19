// Seed names are stable database identities. Localize only global taxonomy display,
// never user-authored notes, session names, or unrecognized admin-created values.
const TAXONOMY_NAMES: Readonly<Record<string, readonly [string, string]>> = {
  Białe: ['White', 'Weiß'],
  Czarne: ['Black', 'Schwarz'],
  Szare: ['Grey', 'Grau'],
  Czerwone: ['Red', 'Rot'],
  Pomarańczowe: ['Orange', 'Orange'],
  Żółte: ['Yellow', 'Gelb'],
  Zielone: ['Green', 'Grün'],
  Turkusowe: ['Turquoise', 'Türkis'],
  Niebieskie: ['Blue', 'Blau'],
  Fioletowe: ['Purple', 'Violett'],
  Różowe: ['Pink', 'Rosa'],
  Beżowe: ['Beige', 'Beige'],
  Brązowe: ['Brown', 'Braun'],
  Złote: ['Gold', 'Gold'],
  Jednolite: ['Solid color', 'Einfarbig'],
  French: ['French', 'French'],
  Ombre: ['Ombre', 'Ombre'],
  'Baby Boomer': ['Baby Boomer', 'Baby Boomer'],
  Marble: ['Marble', 'Marmor'],
  Wzorki: ['Patterns', 'Muster'],
  Matowe: ['Matte', 'Matt'],
  Chromowane: ['Chrome', 'Chrom'],
  Perłowe: ['Pearlescent', 'Perlmutt'],
  Holograficzne: ['Holographic', 'Holografisch'],
  Magnetyczne: ['Magnetic', 'Magnetisch'],
  Brokatowe: ['Glitter', 'Glitzer'],
  Cyrkonie: ['Rhinestones', 'Strass'],
  'Zdobienia 3D': ['3D decorations', '3D-Verzierungen'],
  Folia: ['Foil', 'Folie'],
  Minimalistyczne: ['Minimalist', 'Minimalistisch'],
  Florystyczne: ['Floral', 'Florale Muster'],
  Artystyczne: ['Artistic', 'Künstlerisch'],
};

export function getLocalizedTaxonomyName(name: string, locale: string): string {
  const names = TAXONOMY_NAMES[name];
  if (locale === 'en') {
    return names?.[0] ?? name;
  }
  if (locale === 'de') {
    return names?.[1] ?? name;
  }
  return name;
}
