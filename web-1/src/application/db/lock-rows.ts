import { Prisma } from '../../prisma/js-client';

/**
 * lock-rows — canonical pessimistic row-lock primitives (`SELECT … FOR UPDATE`).
 *
 * ONE home for the FOR UPDATE SQL that is otherwise copy-pasted across the domain. Each MUST be
 * called INSIDE an active interactive `$transaction` (tx) — the row lock lives until that
 * transaction commits/rolls back.
 *
 * DECISION (nie usuwaj tego komentarza) — GLOBALNY INWARIANT KOLEJNOSCI LOCKOW (zweryfikowany:
 * ZERO sitow w odwrotnej kolejnosci): kazdy multi-row pisarz dotykajacy >1 tabeli bierze locki w
 * STALEJ kanonicznej kolejnosci User -> StylistAccount -> SessionContainer -> SupportThread (nizszy
 * pierwszy) — ABBA 40P01 niemozliwy z konstrukcji. Komplementarny z deadlock-retry (withWriteTx):
 * lock NIE pokrywa ukrytych lockow z FK-cascade, wiec retry zostaje belt-and-suspenders dla sciezek
 * z kaskada (gallery-delete vs favorite/moderation).
 *
 * Eksportuje lockStylistAccount (konsument: gallery-delete SA-first) + lockVisitRecord (konsument:
 * addVisitResultPhoto_IO, single-lock — patrz DECISION przy tej funkcji) + lockGalleryRecord
 * (konsument: updateGalleryRecord_IO, single-lock). Migracja
 * pozostalych raw-FOR-UPDATE sitow (moderation lockStylistAccountRow/lockUserRow, session-container
 * lockSessionContainerRow, gallery-pin/salon-staff inline) do tego modulu + combined acquirer
 * (lockUserThenStylistAccount dla BAN) + lock-discipline ratchet = osobna fala (KROK 3b), bo wymaga
 * usuniecia lokalnych helperow z weryfikacja callerow.
 */

export type LockedStylistAccount = { account_id: string };

// StylistAccount: brak @@map -> tabela "StylistAccount", PK "account_id". Docelowo konsoliduje
// lockStylistAccountRow (moderation) + inline FOR UPDATE w gallery-pin / salon-staff (byte-identyczne).
export const lockStylistAccount = async (
  tx: Prisma.TransactionClient,
  accountId: string
): Promise<LockedStylistAccount | null> => {
  const rows = await tx.$queryRaw<LockedStylistAccount[]>`
    SELECT "account_id" FROM "StylistAccount" WHERE "account_id" = ${accountId} FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedUser = { id: string };

// User: @@map("users") (Better Auth) -> tabela "users", PK "id". Pesymistyczny row-lock
// na wierszu usera = najniższy element globalnej kolejności (User -> StylistAccount ->
// SessionContainer -> SupportThread), więc wzięty PIERWSZY nie łamie inwariantu ABBA.
// Konsument: addSupportMessage_IO (User-first, potem lockSupportThreadRow) — serializuje
// per-user message-adds tak, że per-user hourly cap staje się AUTORYTATYWNY (count widzi
// commit poprzednika). DECISION (nie usuwaj): moderation ma jeszcze LOKALNY lockUserRow
// (moderation-admin-concurrency.helper.ts) — jego migracja tutaj = osobna fala (KROK 3b),
// NIE robiona przy tej okazji; ten kanoniczny helper jest forward-path dla nowych callerów.
export const lockUserRow = async (
  tx: Prisma.TransactionClient,
  userId: string
): Promise<LockedUser | null> => {
  const rows = await tx.$queryRaw<LockedUser[]>`
    SELECT "id" FROM "users" WHERE "id" = ${userId} FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedActivePair = { id: string };

// ClientStylistPair: brak @@map -> tabela "ClientStylistPair", PK "id", @@unique([client_user_id,
// stylist_account_id]). Pesymistyczny FOR UPDATE na wierszu AKTYWNEJ pary serializuje read/write
// stylistki z równoległym revoke: revoke = UPDATE status->REVOKED bierze implicit ROW EXCLUSIVE na
// tym wierszu, więc nasz FOR UPDATE albo czeka na jego commit i re-ewaluuje WHERE (Postgres EPQ) i
// wyklucza wiersz gdy już REVOKED, albo idzie pierwszy i revoke czeka -> read/write dzieje się gdy
// para była legalnie ACTIVE. Zwraca wiersz albo null (nie-ACTIVE / nie-istnieje) = zamyka TOCTOU
// check-then-act między pairing-checkiem a read/write.
//
// ZAKRES: TYLKO status=ACTIVE + lock. Guard `is_active` (soft-deleted klientka) jest ODDZIELNY,
// egzekwowany per-caller tam gdzie już jest (visit findActivePairing predykat, contact CLIENT_NOT_FOUND
// przy is_active=false, session-container is_active predykat) — helper go NIE dubluje, by zachować
// istniejące semantyki błędów (np. contact: disabled->NOT_FOUND anti-enumeration, nie UNAUTHORIZED).
//
// DECISION (nie usuwaj tego komentarza) — LOCK-ORDER dla ClientStylistPair: brany PRZED
// VisitRecord i SessionContainer we wszystkich multi-lock pisarzach (visit-write: pair -> visit-record;
// contact: pair single). Żaden pisarz nie bierze VisitRecord/SessionContainer -> pair (odwrotnie),
// więc ABBA niemożliwy. Revoke (pairing-access) = single pair-lock (implicit UPDATE), nie łamie
// kolejności. ClientStylistPair NIE jest w głównym łańcuchu User->StylistAccount->SessionContainer->
// SupportThread (jak VisitRecord) — revoke/visit/contact NIE lockują User/StylistAccount, więc brak
// konfliktu z głównym łańcuchem. `FOR UPDATE` (bez OF) — single-table query, lockuje wiersz pary.
// `requireActiveClient`: bariera write-ścieżek wizyt ma być LUSTREM zewnętrznego
// `findActivePairing` (status ACTIVE **i** `client_user.is_active`); bez tego
// predykaty check-poza-tx i bariera-w-tx różniły się o warunek `is_active`.
// UCZCIWIE o zasięgu: `EXISTS` tylko filtruje, wiersza `users` NIE lockuje, więc
// pod READ COMMITTED soft-delete klientki (UPDATE wyłącznie `users`, para zostaje
// ACTIVE) commitujący między snapshotem tego SELECT-a a lockiem pary nadal
// przechodzi: okno zwęża się do jednego statementu, nie znika.
//
// KOREKTA PO POMIARZE (S121, 2026-09-16) — poprzednia wersja tego akapitu mówiła,
// że „zamknięcie na dobre = soft-delete musi RUSZYĆ wiersz pary w tej samej tx".
// To jest ZA SŁABE i prowadziłoby na manowce. Zmierzone na żywym Postgresie
// (minimalna repro: users + pair, trzy warianty, writer blokowany przez deleter):
//   A. para nietknięta            → writer nie blokuje się w ogóle → okno OTWARTE
//   B. NO-OP `UPDATE pair SET status=status` → writer BLOKUJE SIĘ (1,46 s) i po
//      odblokowaniu MIMO TO dostaje wiersz → okno nadal OTWARTE. EvalPlanQual
//      re-sprawdza kwalifikację na nowej wersji krotki pary, ale podzapytanie
//      EXISTS na `users` leci ze snapshotem statementu, więc wciąż widzi
//      `is_active = true`. Samo dotknięcie wiersza NIE ZAŁATWIA SPRAWY.
//   C. `UPDATE pair SET status='<nie-ACTIVE>'` → writer blokuje się i dostaje
//      PUSTO → okno ZAMKNIĘTE.
// Czyli jedynym mechanizmem, który tu działa, jest zmiana PREDYKATU na samym
// wierszu pary — a tego zabrania decyzja ownera D1 („widmowe sloty", 2026-09-05,
// DOMAIN_SSOT §5.2/§13.1): para z nieaktywną drugą stroną ZOSTAJE ACTIVE, dalej
// liczy się do limitu i NIE podlega rekoncyliacji przy odzyskaniu konta.
//
// Jedyny wariant zgodny z D1: zdenormalizowana kolumna na PARZE (np.
// `client_is_active`) pisana w tej samej tx co soft-delete/ban/recovery, z
// predykatem bariery przeniesionym na nią — wtedy predykat siedzi na wierszu,
// który bierzemy `FOR UPDATE`, więc EPQ go domyka (wariant C, bez ruszania
// `status`). To jednak migracja kontraktu produkcyjnego plus trzy nowe ścieżki
// zapisu, przy skutku ograniczonym do jednego statementu i danych, których
// Model A i tak nie kasuje. ŚWIADOMIE NIEZROBIONE — nie „przeoczone". FOR UPDATE na `users` odrzucone: każdy zapis wizyty serializowałby się
// z każdą mutacją konta klientki, a pisarze wizyt celowo NIE lockują User
// (DECISION wyżej). Domyślnie wyłączone: contact-reveal (client-profile) celowo
// rozdziela „para nieaktywna" (403) od „klientka usunięta" (404) i sprawdza
// is_active osobno, krok dalej. Tej semantyki nie zmieniamy.
export const lockActivePair = async (
  tx: Prisma.TransactionClient,
  clientUserId: string,
  stylistAccountId: string,
  { requireActiveClient = false }: { requireActiveClient?: boolean } = {}
): Promise<LockedActivePair | null> => {
  const activeClientClause = requireActiveClient
    ? Prisma.sql`AND EXISTS (
         SELECT 1 FROM "users" u
          WHERE u."id" = "ClientStylistPair"."client_user_id"
            AND u."is_active" = true
       )`
    : Prisma.empty;

  // DECISION (nie usuwaj tego komentarza) — FRAGMENT `Prisma.sql` SKŁADAMY PRZEZ
  // `Prisma.sql`, A GOTOWY OBIEKT PODAJEMY JAKO ARGUMENT `$queryRaw(...)`.
  // NIE wstawiać `${activeClientClause}` wprost do tagowanego szablonu
  // ``tx.$queryRaw`...` `` — to wygląda identycznie, a jest zepsute:
  // spłaszczanie zagnieżdżonego fragmentu robi konstruktor `Sql` przez
  // `child instanceof Sql`, więc działa TYLKO gdy fragment i szablon zewnętrzny
  // powstały z tej samej instancji modułu `sql-template-tag`. W tagowanej formie
  // szablon zewnętrzny buduje runtime klienta Prisma, a fragment — `Prisma.sql`
  // z tego pliku; w bundlu Next/Turbopack (serwer dev i prod) to NIE jest ta sama
  // klasa, `instanceof` zwraca false i fragment leci jako BIND PARAMETR. Efekt na
  // produkcji: `SELECT ... AND "status"::text = 'ACTIVE' $3 FOR UPDATE` →
  // Postgres 42601 `syntax error at or near "$3"` → 500 na KAŻDEJ ścieżce, która
  // bierze ten lock (zapis wizyty ręcznej, nota, zdjęcie efektu, kasowanie oraz —
  // przez gałąź `Prisma.empty`, która psuje się tak samo — contact-reveal).
  // Dowód, że to bundling, a nie Prisma: w gołym node (ten sam wygenerowany klient,
  // ta sama wersja 7.10.0, także wewnątrz `$transaction`) obie formy działają.
  // Forma z argumentem jest odporna z konstrukcji: spłaszczenie dzieje się w
  // `Prisma.sql` W TYM module, więc obie strony `instanceof` pochodzą z tej samej
  // kopii modułu, a do klienta trafia już jeden płaski `Sql`. To zarazem
  // konwencja całego repo — każde inne miejsce z zagnieżdżeniem
  // (`Prisma.join`/`Prisma.empty`) używa `$queryRaw(Prisma.sql\`...\`)`.
  const query = Prisma.sql`
    SELECT "id"
      FROM "ClientStylistPair"
     WHERE "client_user_id" = ${clientUserId}
       AND "stylist_account_id" = ${stylistAccountId}
       AND "status"::text = 'ACTIVE'
       ${activeClientClause}
     FOR UPDATE`;
  const rows = await tx.$queryRaw<LockedActivePair[]>(query);
  return rows[0] ?? null;
};

export type LockedVisitRecord = { id: string };

// VisitRecord: brak @@map -> tabela "VisitRecord", PK "id". Pesymistyczny lock na wierszu-rodzicu
// serializuje wszystkich piszących result_photos tej wizyty (position = max+1), domykając wyścig na
// @@unique([visit_record_id, position]).
// DECISION (nie usuwaj tego komentarza): konsument (addVisitResultPhoto_IO) bierze TYLKO ten jeden
// lock w swojej tx (żadnego User/StylistAccount/etc.) -> pojedynczy row-lock, ABBA 40P01 niemożliwy z
// konstrukcji, więc VisitRecord poza kanoniczną kolejnością User->StylistAccount->... nie łamie
// globalnego inwariantu (ten dotyczy tylko multi-row pisarzy dotykających >1 tabeli).
export const lockVisitRecord = async (
  tx: Prisma.TransactionClient,
  visitRecordId: string
): Promise<LockedVisitRecord | null> => {
  const rows = await tx.$queryRaw<LockedVisitRecord[]>`
    SELECT "id" FROM "VisitRecord" WHERE "id" = ${visitRecordId} FOR UPDATE`;
  return rows[0] ?? null;
};

export type LockedGalleryRecord = { created_by_account_id: string };

// GalleryRecord: brak @@map -> tabela "GalleryRecord", PK "gallery_record_id". Lock-and-READ
// (zwraca właściciela) serializuje równoległe edycje TEGO SAMEGO rekordu.
// DECISION (nie usuwaj tego komentarza) — DLACZEGO LOCK I DLACZEGO `FOR NO KEY UPDATE`:
// updateGalleryRecord_IO podmienia junctiony kolorów/cech przez deleteMany+createMany. Bez locka
// dwie równoległe edycje pod READ COMMITTED się przeplatały: druga deleteMany czekała na commit
// pierwszej, ale ze snapshotem sprzed niego NIE widziała świeżo wstawionych wierszy pierwszej, po
// czym jej createMany wstawiał te same pary → P2002 na @@unique([gallery_record_id, color_id])
// → 500 (testy-api 2026-09-25: 10 z 15 równoległych edycji). `skipDuplicates` nie jest poprawką:
// usunąłby 500, ale stan końcowy byłby SUMĄ obu zestawów, a edycja ma dać zestaw ostatniego
// piszącego. Lock na wierszu-rodzicu daje pełną serializację: druga edycja startuje od stanu po
// commicie pierwszej i jej zestaw wygrywa w całości.
// `FOR NO KEY UPDATE` zamiast `FOR UPDATE`: koliduje z innym NO KEY UPDATE/UPDATE (czyli
// serializuje edytujących), ale NIE z `FOR KEY SHARE`, które Postgres bierze przy sprawdzaniu FK
// — wstawienie ulubionego, zdjęcia do sesji czy junctiona wskazującego ten rekord nie czeka na
// edycję. Końcowe `galleryRecord.update` (nail_length, kolumna nie-kluczowa) i tak bierze ten
// sam poziom. Pojedynczy lock w tx (bez User/StylistAccount), więc globalna kolejność
// User->StylistAccount->... nie jest naruszona; gallery-delete (SA -> DELETE GR) czeka na nas,
// my nie czekamy na nic, co trzyma on.
export const lockGalleryRecord = async (
  tx: Prisma.TransactionClient,
  galleryRecordId: string
): Promise<LockedGalleryRecord | null> => {
  const rows = await tx.$queryRaw<LockedGalleryRecord[]>`
    SELECT "created_by_account_id" FROM "GalleryRecord"
     WHERE "gallery_record_id" = ${galleryRecordId} FOR NO KEY UPDATE`;
  return rows[0] ?? null;
};

// DECISION (nie usuwaj tego komentarza) — SPAR-005 (webhook per-account serialization):
// TRANSACTION-scoped advisory lock (`pg_advisory_xact_lock`), w przeciwieństwie do session-level
// `pg_try_advisory_lock` (jaki stał do 2026-08-31 w webhooku Stripe, zanim go usunięto na
// rzecz samego row-claimu), jest PgBouncer-safe:
// brany na połączeniu tej samej tx, auto-zwalniany na commit/rollback → działa pod Neon
// transaction-poolingiem (session-lock tam jest MARTWY — acquire i unlock lądują na różnych
// backendach). Blokuje (NIE `_try_`) aż do zdobycia → serializuje współbieżne operacje na tym
// samym kluczu (webhooki tego samego konta): drugi czeka, po commitcie pierwszego czyta JUŻ
// skomitowany snapshot. Konsument: subscription-lifecycle.handler (klucz=customerId, customer↔
// account 1:1) — zamyka lost-update na D10 no-op-gate (gate porównywał STALE snapshot, recency-CAS
// nie advansował → nowszy rescind gubił się za starszym cancelem). Klucz→bigint przez md5 (kolizja
// hash = zbędna serializacja 2 kluczy, nigdy błąd korektności). NIE jest to lock WIERSZA (żaden
// wpis w globalnej kolejności User->StylistAccount->...), więc nie łamie inwariantu ABBA — advisory
// key jest ortogonalny do row-locków; webhook handler bierze TYLKO ten jeden advisory lock.
export const acquireAdvisoryXactLock = async (
  tx: Prisma.TransactionClient,
  key: string
): Promise<void> => {
  // DECISION (nie usuwaj tego komentarza) — `::text` NIE jest ozdobnikiem:
  // `pg_advisory_xact_lock()` zwraca typ `void`, którego driver-adapter Prisma NIE umie
  // zdeserializować — gołe `$queryRaw` z tą kolumną rzuca „Failed to deserialize column of
  // type 'void'" przy KAŻDYM wywołaniu, więc lock nie tylko nie serializował, ale wywracał
  // całą transakcję webhooka (checkout.session.completed + customer.subscription.*).
  // Rzut na `text` daje pustego stringa, który adapter dekoduje bez problemu; semantyka
  // locka jest nietknięta (zweryfikowane: dwie równoległe tx na tym samym kluczu wchodzą
  // sekwencyjnie). Odpowiednikiem jest `$executeRaw`, ale ta funkcja to SELECT — zostaje
  // `$queryRaw`. Bramka regresji: `tests/concurrency/advisory-xact-lock.concurrency.ts`
  // (testy jednostkowe handlerów MOCKUJĄ tę funkcję, więc same tego nie złapią).
  await tx.$queryRaw`
    SELECT pg_advisory_xact_lock(('x' || substr(md5(${key}), 1, 16))::bit(64)::bigint)::text AS locked`;
};
