import type {
  DemoClockUtc,
  DemoVisitSpec,
  DemoMessageSpec,
} from './demo-content-seeding.clients-data';

/**
 * Visits and messages for the main demo client (Karolina) with Ania and Ola.
 * Split out of demo-content-seeding.clients-data.ts so that file stays under
 * the ESLint max-lines limit. Consumed by demo-content-seeding.operations.ts.
 */

/** Karolina↔Ania: 4 wizyty na przestrzeni ~5 miesięcy. */
export const DEMO_KAROLINA_ANIA_VISITS: readonly DemoVisitSpec[] = [
  { daysAgo: 150, serviceNoteIndex: 2, resultPhotoCount: 1 },
  { daysAgo: 110, serviceNoteIndex: 5, resultPhotoCount: 2 },
  { daysAgo: 70, serviceNoteIndex: 0, resultPhotoCount: 1 },
  { daysAgo: 30, serviceNoteIndex: 9, resultPhotoCount: 2 },
] as const;

/**
 * Karolina and Ania: 7 alternating messages. The stylist sends the last one (the client has unread).
 *
 * DECISION: this conversation is on public-page screenshots and must sound natural; its Polish
 * wording comes from another model family (GPT). Layout rules:
 *  - the phone frame shows only the bottom of the thread, so messages 4 to 7 tell the story alone:
 *    the client sent designs picked from the stylist's gallery, the stylist answers expertly on one;
 *  - each message is at most 85 characters (four bubbles on one screen);
 *  - time of day is pinned (`clockUtc`): an older exchange nine days back, designs sent in the evening,
 *    the stylist's reply the next morning.
 * Retired sentences stay in DEMO_KAROLINA_ANIA_RETIRED_MESSAGES: content is the idempotency key, so
 * without removing them the new messages would stand next to the old. (owner)
 */
export const DEMO_KAROLINA_ANIA_MESSAGES: readonly DemoMessageSpec[] = [
  {
    sender: 'STYLIST',
    content: 'Karolina, jak się trzyma nude po ostatniej wizycie?',
    hoursAgo: 216,
    clockUtc: [9, 12],
  },
  {
    sender: 'CLIENT',
    content: 'Świetnie, nic nie odprysło. Czwartek o 16 nadal aktualny?',
    hoursAgo: 216,
    clockUtc: [10, 40],
  },
  {
    sender: 'STYLIST',
    content: 'Tak, do zobaczenia. Hybryda jak zwykle?',
    hoursAgo: 216,
    clockUtc: [10, 52],
  },
  {
    sender: 'CLIENT',
    content:
      'Tak, hybryda. Wybrałam trzy wzory z Twojej galerii i wysłałam Ci je przed wizytą.',
    hoursAgo: 48,
    clockUtc: [17, 21],
  },
  {
    sender: 'STYLIST',
    content:
      'Ten french może dobrze wyglądać przy średniej długości. Cienka końcówka może dać subtelniejszy efekt.',
    hoursAgo: 24,
    clockUtc: [7, 47],
  },
  {
    sender: 'CLIENT',
    content:
      'O, właśnie o to mi chodziło, bo nie chcę, żeby paznokcie wyglądały krócej.',
    hoursAgo: 24,
    clockUtc: [8, 5],
  },
  {
    sender: 'STYLIST',
    content: 'To tak zrobimy. Przygotuję jasny nude pod cienki french.',
    hoursAgo: 24,
    clockUtc: [8, 11],
  },
];

/** Sentences this thread no longer uses (exact match). */
export const DEMO_KAROLINA_ANIA_RETIRED_MESSAGES: readonly string[] = [
  'Cześć Karolina! Widzę, że dołączyłaś do mojego grona. Śmiało pisz, jeśli masz pytania przed wizytą.',
  'Cześć! Bardzo się cieszę. Planuję hybrydę na koniec miesiąca, chciałabym coś w jasnych beżach.',
  'Super pomysł, będzie pasować do lata. Mam dla Ciebie termin w najbliższy czwartek o 16.',
  'Idealnie, zapisuję się. Czy mogę przynieść zdjęcie inspiracji?',
  'Jasne, przynieś śmiało. Na miejscu dobierzemy odcień do Twojej karnacji.',
  'Super, do zobaczenia w czwartek. Mam jeszcze pytanie o długość, wolałabym średnią.',
  'Zanotowane, średnia długość i jasny beż. Do zobaczenia!',
  'Cześć Karolino, miło, że już połączyłaś się ze mną w Nailfolio. Jeśli masz pytania przed wizytą, pisz śmiało.',
  'Cześć Aniu, chciałabym umówić się na czwartek o 16. Myślę o hybrydzie w jasnym beżu.',
  'Mam wolny termin w czwartek o 16.',
  'Pasuje mi, dziękuję. Wysłałam Ci kilka zdjęć z Twojej galerii. Który wzór sprawdzi się przy średniej długości?',
  'Widzę je. Zrobimy hybrydę w jasnym beżu, a odcień dobierzemy na miejscu.',
  'Wolałabym średnią długość. Do zobaczenia w czwartek o 16.',
  'Zanotowałam: hybryda w jasnym beżu, średnia długość. Do zobaczenia w czwartek o 16.',
  'Ten french pasuje do średniej długości, bo cienka końcówka nie skróci paznokci.',
];

/** Notatka stylistki o głównej klientce demo (karta klientki). */
export const DEMO_KAROLINA_ANIA_CRM_NOTE =
  'Lubi jasny beż, nude i średnią długość. Nie przepada za brokatem. Za miesiąc jedzie na urlop.';
export const DEMO_KAROLINA_ANIA_CRM_NOTE_UPDATED_DAYS_AGO = 28;
/** Pora dnia zapisu notatki (po wizycie, nie o godzinie uruchomienia seeda). */
export const DEMO_KAROLINA_ANIA_CRM_NOTE_CLOCK_UTC: DemoClockUtc = [15, 20];

/**
 * Karolina↔Ola: 3 wiadomości, wszystkie przeczytane. Poprzednie zdania stoją
 * w `DEMO_KAROLINA_OLA_RETIRED_MESSAGES` (ten sam mechanizm co para z Anią).
 */
export const DEMO_KAROLINA_OLA_MESSAGES: readonly DemoMessageSpec[] = [
  {
    sender: 'CLIENT',
    content:
      'Cześć Olu, widziałam Twoje prace na Instagramie. Bardzo mi się podobają.',
    hoursAgo: 240,
  },
  {
    sender: 'STYLIST',
    content: 'Dziękuję. Jeśli chciałabyś się umówić, napisz.',
    hoursAgo: 220,
  },
  {
    sender: 'CLIENT',
    content:
      'Odezwę się, bo we wrześniu idę na wesele siostry i chciałabym się wcześniej umówić.',
    hoursAgo: 192,
  },
];

/** Sentences the Karolina and Ola thread no longer uses (exact match). */
export const DEMO_KAROLINA_OLA_RETIRED_MESSAGES: readonly string[] = [
  'Cześć Ola! Widziałam Twoje prace na Instagramie, są przepiękne.',
  'Dziękuję bardzo! Miło mi, że zaglądasz. Daj znać, jeśli chcesz się umówić.',
  'Na pewno się odezwę, planuję wizytę na wesele siostry we wrześniu.',
];
