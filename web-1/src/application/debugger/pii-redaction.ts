/**
 * SSOT dla kluczy niosących ADRES E-MAIL w logach i dla samej redakcji.
 *
 * DECISION (nie usuwaj tego komentarza) — S113, po przeglądzie:
 * Istniały DWIE niezależne listy PII, każda przy innym pisarzu do składu logów:
 * `EMAIL_KEY_REGEX` w `error-handler.ts` (redaguje do domeny) i `PII_DENY_KEYS`
 * w `event-log/event-log-io.wrapper.ts` (kasuje klucz). Rozjechały się dokładnie
 * tam, gdzie boli: pierwsza wymieniała `to`, `recipient`, `newEmail`, druga nie —
 * a to właśnie druga obsługuje `writeRawEventLog_IO`, którym magic-link i transport
 * pocztowy zapisują `to`/`identifier`. Rozszerzenie jednej listy nie zamykało więc
 * nic po stronie drugiej. Lista jest teraz jedna; MECHANIZM zostaje różny i tak ma
 * być: logger redaguje do domeny (potrzebuje sygnału o awarii dostawcy), a
 * defense-in-depth przy zapisie surowych ciał kasuje klucz w całości.
 *
 * `identifier` jest w zbiorze świadomie: to nazwa pola adresata w adapterze
 * magic-linka, czyli JEDYNEJ ścieżki logowania w produkcie — każda nieudana dostawa
 * logowała tamtędy pełny adres.
 *
 * Redagujemy DO SAMEJ DOMENY, nigdy hashem: przestrzeń adresów jest słownikowa,
 * więc hash bez sekretu odwraca się tęczową tablicą, czyli byłby pseudonimizacją
 * udającą anonimizację. Domena zachowuje jedyny sygnał operacyjny, jaki adres niesie
 * („wszystko na @gmail.com odbija"), a nie wskazuje osoby.
 */

/**
 * Nazwy pól, których NIE DA SIĘ wyprowadzić ze wzorca — samo słowo „mail" w nich
 * nie występuje, więc muszą być wyliczone.
 */
export const EMAIL_KEY_NAMES = [
  'to',
  'recipient',
  'recipients',
  'from',
  'replyTo',
  'reply_to',
  'identifier',
] as const;

const EMAIL_KEY_SET = new Set<string>(
  EMAIL_KEY_NAMES.map(name => name.toLowerCase())
);

/**
 * DECISION (nie usuwaj tego komentarza) — WZORZEC, NIE WYLICZANKA (2026-09-16):
 * rodzina „*mail*" jest rozpoznawana REGUŁĄ, a nie listą nazw. Poprzednia wersja
 * wyliczała `email`/`newEmail`/`customerEmail`/`ownerEmail`… i przez to NIE ŁAPAŁA
 * `userEmail` ani `reporterEmail` — czyli dokładnie tych pól, którymi alert
 * supportu i alert moderacji wysyłały `payload: params` przy braku admina
 * (`SUPPORT_ALERT_NO_ADMIN`, `SUPPORT_MSG_ALERT_NO_ADMIN`,
 * `MODERATION_ALERT_NO_ADMIN`). Pełny adres lądował w składzie logów na 90 dni,
 * a przy `mode:'warn'` również w PostHogu.
 * To trzecia odsłona jednej klasy: dwie listy się rozjechały (S113), a teraz
 * jedna lista okazała się ułamkiem tego, co istnieje — czyli defekt opisany
 * wprost w AGENTS.md §GUARDS („hardcoded list of IDENTIFIERS is always
 * a fraction"). Nowe pole `*Email` jest odtąd chronione Z KONSTRUKCJI, bez
 * dopisywania się do czegokolwiek. Wyliczanka zostaje WYŁĄCZNIE dla nazw, w
 * których słowa „mail" nie ma (`to`, `recipient`, `identifier`…) — tych żaden
 * wzorzec nie zgadnie.
 */
const EMAIL_KEY_PATTERN = /e?mails?$/;

/**
 * Czy pod tym kluczem spodziewamy się adresu e-mail. Separatory znikają PRZED
 * dopasowaniem, żeby `user_email`, `userEmail` i `USEREMAIL` były jednym pytaniem.
 * Nadmiarowe trafienie jest tanie: `redactEmailValue` oddaje wartość nie-adresową
 * nietkniętą, więc koszt pomyłki to redakcja czegoś, co i tak nie było adresem.
 */
export const isEmailKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[_\-.]/g, '');
  return (
    EMAIL_KEY_SET.has(key.toLowerCase()) || EMAIL_KEY_PATTERN.test(normalized)
  );
};

const EMAIL_VALUE_REGEX = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/** Globalny wariant do TEKSTU SWOBODNEGO (komunikaty logów, treść wyjątku). */
const EMAIL_IN_TEXT_REGEX = /[^\s@"'<>()[\]{},;:]+@([\w-]+(?:\.[\w-]+)+)/g;

/**
 * Redaguje adresy osadzone w zdaniu.
 *
 * To NIE jest nadgorliwość: komunikaty w tym repo sklejają adres w treść
 * (`Invalid email address: "${params.to}"`, `notification sent to ${ownerEmail}`),
 * a pole `message` szło do składu logów i do PostHoga (jako treść wyjątku) całkiem
 * nietknięte. Efekt był gorszy niż brak redakcji: payload obok był już zredagowany,
 * więc rekord WYGLĄDAŁ na czysty.
 */
/**
 * Wersja pakietu NIE jest domena: `next@16.3.4` pasuje do wzorca adresu, a odkad
 * redakcja tekstu chodzi po KAZDYM lisciu payloadu, zdanie „Cannot find module
 * next@16.3.4" wracalo z logow jako „[EMAIL]@16.3.4" — nazwa pakietu znikala,
 * a czytajacy widzial zredagowany adres i nie mial jak sie domyslic, co tam bylo.
 */
/**
 * DOKLADNIE trzy czlony (plus opcjonalny sufiks prerelease/build) — czyli semver,
 * a nie „cokolwiek z kropkami i cyframi". Pierwsza wersja brala `^\d+(\.\d+)+$`
 * i wpuszczala przez to `bob@192.168.1.10` (cztery czlony) jako „wersje", czyli
 * ROBILA DZIURE w redakcji, zeby zalatac literowke w logu. Sufiks jest tu, bo
 * bledy rozwiazywania modulow niosa najczesciej `next@16.3.4-canary.12`.
 */
const VERSION_LIKE_DOMAIN = /^\d+\.\d+\.\d+([-+][\w.]+)?$/;

export const redactEmailsInText = (text: string): string =>
  text.replace(EMAIL_IN_TEXT_REGEX, (full: string, domain: string) =>
    VERSION_LIKE_DOMAIN.test(domain) ? full : `[EMAIL]@${domain}`
  );

/**
 * `anna.kowalska@gmail.com` → `[EMAIL]@gmail.com`.
 * Wartość, która nie jest adresem, wraca nietknięta — `to: 'ACTIVE'` czy
 * `recipient: 42` to legalne, nie-adresowe użycia tych samych nazw pól.
 */
export const redactEmailValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const match = EMAIL_VALUE_REGEX.exec(value.trim());
  if (match) {
    return `[EMAIL]@${match[1]}`;
  }
  // Dopasowanie CALOSCI nie wystarcza: transport pocztowy produkuje forme
  // z nazwa wyswietlana — `"Anna Kowalska" <anna@x.com>` — i to wlasnie pod
  // kluczami `to`/`identifier`, czyli tymi, dla ktorych ten modul powstal.
  // Taka wartosc wychodzila stad DOSLOWNIE, z adresem w srodku. Nie-adres
  // (`to: 'ACTIVE'`) nie ma czego dopasowac i wraca nietkniety.
  return redactEmailsInText(value);
};
