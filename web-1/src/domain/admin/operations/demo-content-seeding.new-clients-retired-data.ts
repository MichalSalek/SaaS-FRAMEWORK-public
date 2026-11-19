/**
 * Retired sentences from the threads of Ania's seven newer clients in
 * `DEMO_NEW_CLIENTS` (key = slug). A separate file only because of the ESLint
 * max-lines limit in demo-content-seeding.clients-data.ts. They go to
 * `MessageThreadTarget.retiredContents` (demo-content-seeding.targets.ts):
 * the seed deletes them from the client-to-Ania pair, because content is the
 * match key and a new message would otherwise stand beside the old one.
 * Changing a client's message? Add the old sentence here (exact match).
 */
export const DEMO_NEW_CLIENT_RETIRED_MESSAGES: Readonly<
  Record<string, readonly string[]>
> = {
  julia: [
    'Cześć Julia! Zapraszam na sesję inspiracji, wrzuciłam Ci nowe zdjęcia.',
    'Super, już zerknęłam, bardzo mi się podobają!',
    'Cieszę się, daj znać jak wybierzesz.',
  ],
  magdalena: [
    'Cześć! Widziałam nowe wzory na Twoim profilu, są przepiękne.',
    'Dziękuję bardzo! Miło mi to słyszeć.',
    'Jasne, napisz proszę, który dzień Ci pasuje.',
    'Może być środa po południu? Daj znać czy masz wolne.',
  ],
  natalia: [
    'Cześć! Zastanawiam się nad zmianą kształtu na migdał.',
    'Migdał świetnie sprawdzi się przy Twojej długości płytki, chętnie pomogę.',
    'To się umawiamy, wysyłam Ci sesję z inspiracjami.',
    'Super, już widzę zdjęcia, mam kilka pomysłów na rozwinięcie.',
  ],
  zuzanna: [
    'Cześć Zuzanna! Tak, robię zdobienia 3D, chętnie pokażę przykłady na wizycie.',
    'Świetnie, w takim razie umawiam się na przyszły tydzień.',
    'To chciałabym się umówić na przyszły tydzień.',
  ],
  aleksandra: [
    'Cześć! Mam uczulenie na aceton, czy to problem przy zdejmowaniu hybrydy?',
    'Nie ma problemu, używam łagodniejszego zmywacza. Dam Ci znać, jak się sprawdzi.',
    'Nie ma problemu, używam łagodniejszego zmywacza, dam Ci znać jak się sprawdzi.',
    'Aha, i pamiętaj żeby nie moczyć rąk od razu po wizycie.',
    'Pamiętaj też, żeby nie moczyć rąk od razu po wizycie.',
  ],
  weronika: [
    'Cześć! Planuję wizytę na urodziny, chciałabym coś wyjątkowego.',
    'Świetnie, mam kilka pomysłów na zdobienia, wyślę Ci sesję z inspiracjami.',
    'Bardzo dziękuję, już czekam!',
    'Właśnie wysłałam, zerknij kiedy będziesz miała chwilę.',
    'Cieszę się! Do zobaczenia na wizycie.',
  ],
  paulina: [
    'Cześć Paulina! Dawno się nie widziałyśmy, jak się miewasz?',
    'Cześć! Wszystko dobrze, planuję wrócić na wizytę w tym miesiącu.',
  ],
};
