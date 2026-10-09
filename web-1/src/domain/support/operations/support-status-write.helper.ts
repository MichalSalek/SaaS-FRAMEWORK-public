/**
 * Support thread status-write helper (optimistic concurrency, finding support-1).
 *
 * Applies an admin status change to a SupportThread that is ALREADY pessimistically
 * locked (lockSupportThreadRow / FOR UPDATE) by the caller, inside the SAME $transaction.
 * Encapsulates the USER-FIRST optimistic-concurrency guard so the operation stays lean.
 */

import type { Prisma } from '../../../prisma/js-client';
import type { SupportThreadStatus } from '@kernel/models/support/support.dto';
import { SupportSenderTypeValue } from '@kernel/models/support/support.dto';

// Shape is intentionally a subset of the caller's $transaction result union
// ({ ok:true } | { ok:false; reason:'NOT_FOUND' } | { ok:false; reason:'STALE' }) so the
// operation can return it directly — NOT_FOUND is decided by the caller before this runs.
//
// DECISION (nie usuwaj tego komentarza) — no-op idempotency (finding support-2, cosmetic):
// `noop?: true` na gałęzi success sygnalizuje, że status DOCELOWY == status BIEŻĄCY, więc
// helper świadomie POMINĄŁ write (redundant supportThread.update na CLOSED->CLOSED itp.).
// Pole jest OPCJONALNE i tylko na `ok:true`, więc `{ ok:true; noop?:true }` pozostaje
// width-assignable do węższego `{ ok:true }` z generyka $transaction w callerze (support-
// admin.operations.ts) — caller kompiluje BEZ zmian i ignoruje flagę, dopóki jej nie odczyta.
// Audit-noise (duplicate SUPPORT_STATUS_CHANGED) fire'uje w CALLERZE (reportIssueBackend
// gate'owane tylko na txResult.ok), więc jego wyciszenie wymaga jednolinijkowej gałęzi po
// stronie callera (zgłoszone w needsKernel) — TU domykamy root-cause: redundant DB write.
export type SupportStatusWriteResult =
  { ok: true; noop?: true } | { ok: false; reason: 'STALE' };

// DECISION (nie usuwaj tego komentarza) — concurrency lost-update (finding support-1),
// USER-FIRST residual: ten helper domyka wyścig "user dodaje msg do legalnie-OPEN wątku,
// admin zamyka na STALE widoku -> msg uwięziona w CLOSED". Wołać WYŁĄCZNIE po
// lockSupportThreadRow (FOR UPDATE) w tej samej tx — lock serializuje pisarzy, ten helper
// dokłada warstwę optimistic-concurrency dla zmian, których lock sam nie cofnie (commit
// nastąpił, zanim close zobaczył wiadomość).
//
// Brak (albo null) expectedUpdatedAt => unconditional update (backward-compat, bez guardu).
//
// DECISION (nie usuwaj tego komentarza) — null===absent (finding support-l2-2, HIGH REGRESJA):
// `expectedUpdatedAt` przyjmuje też `null`, bo JSON `null` z body REALNIE tu dociera: walidator
// (shared-kernel support.validation.ts) celowo POMIJA null ("Absent => unconditional status
// change") i przepuszcza go jako valid, a handler/operacja przekazują body verbatim. Gdyby guard
// łapał tylko `=== undefined`, null wpadałby do ścieżki warunkowej: `new Date(null)` = epoch 1970
// (valid Date, NIE NaN) -> updateMany WHERE updated_at=1970 matchuje 0 wierszy -> ZAWSZE STALE ->
// 409 na każdą zmianę statusu z null. Normalizujemy więc null≡undefined TU (single point, domyka
// wszystkie ścieżki wywołania, spójne z intencją walidatora). Typ rozszerzony do `| null` jest
// type-honest: null jest legalnym wejściem znaczącym "unconditional", nie błędem.
//
// Z konkretnym expectedUpdatedAt sprawdzamy DWA sygnały staleness (wystarczy jeden, by odrzucić):
//
//  0) DECISION (nie usuwaj tego komentarza) — ROOT-CAUSE FIX upstream (finding support-occ-open-open):
//     addSupportMessage_IO ZAWSZE bumpuje teraz SupportThread.updated_at przy KAŻDEJ user-msg (touch
//     wiersza, także OPEN->OPEN — patrz DECISION w support-thread.operations.ts). Dzięki temu Signal 2
//     (updated_at != expected) wykrywa KAŻDĄ świeżą user-odpowiedź, w tym do już-OPEN wątku, który
//     PRZEDTEM był niewidoczny (residual). Signal 2 jest więc od teraz KOMPLETNY sygnałem staleness;
//     Signal 1 (poniżej) pozostaje jako DEFENSE-IN-DEPTH na astronomiczny same-ms edge (i historyczne
//     dane sprzed fixu, gdzie stary OPEN->OPEN residual mógł nie ruszyć updated_at). Signal 1 NIE
//     produkuje false-positive po fixie: właściciel updated_at==expected to nadal ta sama, jedna
//     USER-msg z tej samej tx (create firstMsg LUB dowolna user add-message — obie bundlują 1 msg +
//     bump w jednej tx), więc baseline=1 i STALE dopiero przy DODATKOWEJ (count>1).
//
//  1) DECISION (nie usuwaj tego komentarza) — SAME-MS residual USER-msg vs UPDATED_AT-OWNER baseline
//     (finding support-l2-1 same-ms; korekty support-occ-reopen-permanent-409 i support-occ-userreopen):
//     HISTORYCZNIE add-message do OPEN->OPEN NIE bumpowało SupportThread.updated_at (@updatedAt ruszało
//     tylko przy UPDATE wiersza wątku; user path robił update tylko przy ZMIANIE statusu — TO był korzeń
//     buga, naprawiony w pkt 0). Sam updated_at więc NIE wykryłby residualu, który truncuje do TEJ SAMEJ
//     ms co expected (created_at i updated_at to
//     Postgres timestamp(3) = ms; brak sub-ms, więc same-ms residual jest czasowo nieodróżnialny od
//     expected — strict `gt` by go zgubił). DLATEGO i tylko dlatego patrzymy na SupportMessage —
//     ale WYŁĄCZNIE na trafienia same-ms (created_at == expected), NIE na `>= expected`.
//
//     KORZEŃ poprzedniego buga (naive `>=`): expected = updated_at = znacznik OSTATNIEJ zmiany
//     statusu. Admin ładuje widok w czasie T_load >= updated_at i widzi WSZYSTKIE wiadomości z
//     created_at <= T_load. USER-msgs z updated_at < created_at <= T_load to "legalny middle-band"
//     (admin JE WIDZIAŁ), ale T_load NIE jest nigdzie zapisane — DB nie odróżni middle-band
//     (widzianego) od residualu (po snapshocie). `count(created_at >= expected) > 1` traktował CAŁY
//     middle-band jako staleness => 409 na: (a) close po reopen+reply OPEN->OPEN (M2.created_at >
//     reopen.updated_at, different-ms) — 409 PERMANENTNY, bo updated_at się już nie ruszy; (b) close
//     świeżego wątku, gdy user wysłał 2 wiadomości ZANIM admin spojrzał (obie widziane, druga
//     different-ms) — też false 409. To over-rejection legalnego "first/next write".
//     Different-ms band jest FUNDAMENTALNIE niejednoznaczny (widziany vs nie-widziany nieodróżnialne
//     bez T_load), więc go NIE używamy do odrzucania — od tego jest Signal 2 (zmiana updated_at) i
//     pesymistyczny FOR UPDATE lock (support-thread-lock.helper.ts). Liczymy TYLKO same-ms residual.
//
//     BASELINE = ile USER-msgs LEGALNIE może mieć created_at DOKŁADNIE == expected w momencie
//     snapshotu. Tylko sender_type=USER (admin-reply SUPPORT nie unieważnia decyzji admina o
//     statusie i nie wlicza się do baseline ani do count).
//
//     DECISION (nie usuwaj tego komentarza) — UPDATED_AT-OWNER baseline (finding support-occ-
//     userreopen, korekta poprzedniego firstMsg-only baseline): legalna USER-msg z created_at ==
//     expected istnieje, gdy transakcja, która ustawiła bieżące updated_at == expected, w TEJ SAMEJ
//     tx wstawiła także USER-msg. W naszym kodzie taką tx-ę robią DOKŁADNIE dwie ścieżki:
//       (a) fresh-create — create robi wątek-row + pierwszą USER-msg w jednym nested `create`, więc
//           firstMsg.created_at == updated_at == expected (zweryfikowane: fresh first-close => 200);
//       (b) USER-reopen przez add-message (addSupportMessage_IO, RESOLVED->OPEN) — w JEDNEJ tx
//           wstawia USER-msg M2 ORAZ robi supportThread.update {status:OPEN}. M2 (Prisma
//           @default(now()) = JS new Date()) i reopen-update (@updatedAt = JS new Date()) to DWA
//           sąsiednie new Date() w tej samej tx; OBA truncują do timestamp(3) = ms => w ~15-30%
//           przypadków M2.created_at == updated_at == expected (zmierzone: same-ms == permanent-409,
//           1:1). W obu (a)/(b) ta JEDNA USER-msg JEST właścicielem updated_at == expected, więc
//           admin, którego snapshot ma updated_at == expected, JĄ WIDZIAŁ (atomowy commit tej tx) —
//           NIE jest residualem. KOREKTA bugu: poprzedni baseline patrzył tylko na firstMsg, więc
//           dla (b) baseline=0, count=1 => 1>0 => STALE PERMANENTNY (updated_at już się nie ruszy,
//           re-fetch daje to samo expected => każdy retry 409). Błędne były też dwie przesłanki
//           poprzedniego komentarza: „reopen w ogóle nie tworzy USER-msg" (prawda dla ADMIN-reply
//           reopen, FAŁSZ dla USER add-message reopen — (b) tworzy M2) oraz „created_at = DB
//           CURRENT_TIMESTAMP" (created_at = Prisma JS new Date(), TEN SAM zegar co updated_at —
//           dlatego kolizja ms realna, nie egzotyczna).
//
//     Właściciel updated_at to ZAWSZE co najwyżej JEDNA USER-msg na danej ms (create/reopen bundlują
//     1 USER-msg; admin resolve/close/reply bundlują 0). Więc baseline = 1 ⇔ istnieje USER-msg z
//     created_at == expected (== ten właściciel), inaczej baseline = 0. STALE ⇔ same-ms count > 1,
//     czyli istnieje DODATKOWA USER-msg na tej ms PONAD właściciela = genuine residual (lost-update:
//     druga add-message bez zmiany statusu, niewidoczna dla updated_at). To trzyma wszystkie
//     niezmienniki round-1: fresh first-close (count 1 = sam właściciel) => 200; fresh + drugi
//     USER-msg na DOKŁADNIE tej samej ms (count 2 > 1) => STALE 409 (residual nadal łapany);
//     reopen-different-ms (count 0, M2.created_at < updated_at) => 200 via Signal 2. JEDNOCZEŚNIE
//     domyka support-occ-userreopen: reopen-same-ms (count 1 = właściciel M2) => 200, koniec
//     permanent-409. Admin resolve/close (status-only UPDATE, 0 USER-msg na expected) => count 0 =>
//     baseline 0, Signal 2 rządzi — bez regresji.
//     EDGE (świadomie po stronie OCC-policy „same-ms = re-ewaluacja", NIE leak): potrójna kolizja ms
//     (np. residual USER-msg z osobnej tx trafia DOKŁADNIE w ms wcześniejszego status-UPDATE-u przy
//     niezmienionym updated_at) jest nieodróżnialna od właściciela bez T_load; przy count 1 => 200.
//     Wymaga zbiegu kilku niezależnych new Date() do tej samej ms PONAD ~30% kolizję same-tx, więc
//     astronomicznie rzadka; spójna z udokumentowaną filozofią „granica same-ms => safe-failure /
//     re-ewaluacja" (FOR UPDATE lock + Signal 2 chronią wszystkie different-ms wyścigi).
//  2) updated_at != expected — wątek-wiersz zmienił się od snapshotu (reopen / inny
//     change-status = stale VERSION). Realizowane jako updateMany WHERE updated_at = expected;
//     count===0. To jest PODSTAWOWY, niezawodny sygnał staleness (Signal 1 jest tylko domknięciem
//     same-ms residualu, którego Signal 2 z definicji nie widzi).
// Stale => NIE piszemy statusu; wątek zostaje w bieżącym stanie (msg actionable w OPEN-queue),
// caller zwraca 409 i admin re-ewaluuje.
export const applySupportStatusWrite = async (
  tx: Prisma.TransactionClient,
  threadId: string,
  status: SupportThreadStatus,
  expectedUpdatedAt: string | Date | null | undefined
): Promise<SupportStatusWriteResult> => {
  // null≡undefined => unconditional (patrz DECISION powyżej). `== null` łapie OBA.
  if (expectedUpdatedAt == null) {
    // No-op short-circuit (finding support-2): status docelowy == bieżący => POMIŃ write.
    // Wiersz jest już FOR UPDATE-locked przez callera w tej samej tx (lockSupportThreadRow),
    // więc ten select jest tani i wolny od kontencji — nie bierze nowego locka.
    const current = await tx.supportThread.findUnique({
      where: { id: threadId },
      select: { status: true },
    });
    if (current !== null && current.status === status) {
      return { ok: true, noop: true };
    }

    await tx.supportThread.update({
      where: { id: threadId },
      data: { status },
    });
    return { ok: true };
  }

  const expected = new Date(expectedUpdatedAt);

  // Signal 1: SAME-MS residual USER-msg (created_at == expected) vs UPDATED_AT-OWNER baseline
  // (patrz DECISION powyżej). Liczymy WYŁĄCZNIE trafienia na DOKŁADNIE tę samą milisekundę co
  // expected — jedyny residual niewidoczny dla updated_at (Signal 2). `>=` był nadmierny: zamiatał
  // legalny middle-band (wiadomości widziane przez admina po ostatniej zmianie statusu, ale po
  // snapshot-updated_at) => false 409 na close-po-reopenie i fresh-2-msg-before-load (oba different-
  // ms). Właściciel updated_at == expected (firstMsg z fresh-create LUB M2 z USER-reopen) to ZAWSZE
  // co najwyżej JEDNA legalna USER-msg na tej ms (create/reopen bundlują 1 USER-msg w tej samej tx
  // co updated_at-write; admin resolve/close/reply bundlują 0). Dlatego baseline = 1, gdy w ogóle
  // jakaś USER-msg siedzi na tej ms (== ten właściciel), inaczej 0; STALE dopiero przy DODATKOWEJ
  // (count > 1) = genuine residual z osobnej tx (lost-update niewidoczny dla updated_at).
  const userMessagesAtSameMs = await tx.supportMessage.count({
    where: {
      thread_id: threadId,
      sender_type: SupportSenderTypeValue.USER,
      // Same-ms only (== expected), NIE `gte`: patrz DECISION (KORZEŃ buga = naive `>=`).
      created_at: { equals: expected },
    },
  });

  const baseline = userMessagesAtSameMs >= 1 ? 1 : 0;

  if (userMessagesAtSameMs > baseline) {
    return { ok: false, reason: 'STALE' };
  }

  // No-op short-circuit (finding support-2), MUSI być PO obu sygnałach staleness, NIGDY przed:
  // gdy status docelowy == bieżący, redundant write pomijamy — ale TYLKO jeśli snapshot jest
  // świeży. Świeżość = Signal 2 (updated_at == expected), więc no-op gatujemy tym SAMYM
  // predykatem co realny write (count===0 => STALE => 409, nie ciche no-op). Inaczej CLOSED->
  // CLOSED na wątku zbumpowanym współbieżnie maskowałby konflikt zamiast zwrócić STALE.
  // findFirst (nie write) na (id, updated_at=expected): match => no-op skip, brak match => STALE.
  const fresh = await tx.supportThread.findFirst({
    where: { id: threadId, updated_at: expected },
    select: { status: true },
  });

  if (fresh === null) {
    return { ok: false, reason: 'STALE' };
  }

  if (fresh.status === status) {
    return { ok: true, noop: true };
  }

  const updated = await tx.supportThread.updateMany({
    where: { id: threadId, updated_at: expected },
    data: { status },
  });

  if (updated.count === 0) {
    return { ok: false, reason: 'STALE' };
  }

  return { ok: true };
};
