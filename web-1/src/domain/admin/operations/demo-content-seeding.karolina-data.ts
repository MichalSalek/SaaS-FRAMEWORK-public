import type {
  DemoVisitSpec,
  DemoMessageSpec,
} from './demo-content-seeding.clients-data';

/**
 * Wizyty i wiadomości demo-klientki głównej (Karolina) z Anią i Olą —
 * wydzielone z demo-content-seeding.clients-data.ts wyłącznie, żeby ten plik
 * nie przekroczył limitu ESLint max-lines (dane 7 nowych klientek same w
 * sobie są duże). Zużywane przez demo-content-seeding.operations.ts.
 */

/** Karolina↔Ania: 4 wizyty na przestrzeni ~5 miesięcy. */
export const DEMO_KAROLINA_ANIA_VISITS: readonly DemoVisitSpec[] = [
  { daysAgo: 150, serviceNoteIndex: 2, resultPhotoCount: 1 },
  { daysAgo: 110, serviceNoteIndex: 5, resultPhotoCount: 2 },
  { daysAgo: 70, serviceNoteIndex: 0, resultPhotoCount: 1 },
  { daysAgo: 30, serviceNoteIndex: 9, resultPhotoCount: 2 },
] as const;

/** Karolina↔Ania: 7 wiadomości na przemian, kończy stylistka ~2h temu (klientka ma unread). */
export const DEMO_KAROLINA_ANIA_MESSAGES: readonly DemoMessageSpec[] = [
  {
    sender: 'STYLIST',
    content:
      'Cześć Karolina! Widzę, że dołączyłaś do mojego grona. Śmiało pisz, jeśli masz pytania przed wizytą.',
    hoursAgo: 480,
  },
  {
    sender: 'CLIENT',
    content:
      'Cześć! Bardzo się cieszę. Planuję hybrydę na koniec miesiąca, chciałabym coś w jasnych beżach.',
    hoursAgo: 360,
  },
  {
    sender: 'STYLIST',
    content:
      'Super pomysł, będzie pasować do lata. Mam dla Ciebie termin w najbliższy czwartek o 16.',
    hoursAgo: 240,
  },
  {
    sender: 'CLIENT',
    content: 'Idealnie, zapisuję się. Czy mogę przynieść zdjęcie inspiracji?',
    hoursAgo: 120,
  },
  {
    sender: 'STYLIST',
    content:
      'Jasne, przynieś śmiało. Na miejscu dobierzemy odcień do Twojej karnacji.',
    hoursAgo: 26,
  },
  {
    sender: 'CLIENT',
    content:
      'Super, do zobaczenia w czwartek. Mam jeszcze pytanie o długość, wolałabym średnią.',
    hoursAgo: 5,
  },
  {
    sender: 'STYLIST',
    content: 'Zanotowane, średnia długość i jasny beż. Do zobaczenia!',
    hoursAgo: 2,
  },
];

/** Karolina↔Ola: 3 wiadomości, wszystkie przeczytane. */
export const DEMO_KAROLINA_OLA_MESSAGES: readonly DemoMessageSpec[] = [
  {
    sender: 'CLIENT',
    content: 'Cześć Ola! Widziałam Twoje prace na Instagramie, są przepiękne.',
    hoursAgo: 240,
  },
  {
    sender: 'STYLIST',
    content:
      'Dziękuję bardzo! Miło mi, że zaglądasz. Daj znać, jeśli chcesz się umówić.',
    hoursAgo: 220,
  },
  {
    sender: 'CLIENT',
    content:
      'Na pewno się odezwę, planuję wizytę na wesele siostry we wrześniu.',
    hoursAgo: 192,
  },
];
