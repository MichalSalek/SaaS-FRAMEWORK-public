/**
 * Support Admin Operations (get-all / reply / change-status / get-messages).
 *
 * DECISION (nie usuwaj tego komentarza): Defense-in-depth — każda operacja wymaga
 * `currentUser` i sprawdza `requireAdminPermission` PRZED query. Middleware check to
 * pierwsza linia obrony, ale przy reuse (background job, internal API, testy) guard w
 * operacji blokuje misuse. Spójność z admin-user-management.operations.ts (ten sam pattern).
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { AdminInsufficientPermissionsError } from '@kernel/domain/admin/admin-errors.types';
import type {
  SupportThreadNotFoundError,
  SupportThreadClosedError,
} from '@kernel/domain/support/support-errors.types';
import {
  assertType,
  isSupportThreadStatusNarrower,
  isSupportSenderTypeNarrower,
} from '@kernel/models/type_narrowing';
import {
  SupportSenderTypeValue,
  SupportThreadStatusValue,
} from '@kernel/models/support/support.dto';
import type {
  SUPPORT_DTO_API_V1,
  SupportThreadAdminListItem,
  SupportThreadStatus,
} from '@kernel/models/support/support.dto';
import { requireAdminPermission } from '@domain/admin/admin.guards';
import type { GetCurrentUserOutputOptimistic } from '@domain/user/user.types';
import { lockSupportThreadRow } from './support-thread-lock.helper';
import { applySupportStatusWrite } from './support-status-write.helper';
import { supportDbFailure } from './support-admin-error.helper';
import { resolveSupportThreadCursor } from './support-cursor.helper';
import {
  ADMIN_THREAD_ROW_SELECT,
  buildAdminThreadWhere,
  fetchAwaitingReplyThreadPage,
  toAdminThreadListItems,
  type AdminThreadListFilters,
} from './support-admin-list.helper';

// ── Admin Get All Threads ──

type AdminGetAllThreadsResult = {
  threads: SupportThreadAdminListItem[];
  nextCursor: string | null;
};

/**
 * Get all support threads (admin) with cursor pagination (default 50, max 100).
 * Cursor by SupportThread.id; orderBy id desc for stable traversal.
 */
export const adminGetAllThreads_IO = async (
  currentUser: GetCurrentUserOutputOptimistic['currentUser'],
  filters: AdminThreadListFilters = {},
  pagination?: { cursor?: string | undefined; take?: number | undefined }
): Promise<
  OperationResult<
    AdminGetAllThreadsResult,
    DatabaseError | ValidationError | AdminInsufficientPermissionsError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  const cursor = pagination?.cursor;
  const take = pagination?.take ?? 50;
  const effectiveTake = Math.min(Math.max(take, 1), 100);

  try {
    // "Awaiting reply" = the list behind the admin menu badge. Its page is
    // selected by the badge's own SQL predicate (see fetchAwaitingReplyThreadPage);
    // everything after the page selection is shared with the ordinary list.
    if (filters.awaitingReply === true) {
      const page = await fetchAwaitingReplyThreadPage({
        cursor,
        category: filters.category,
        take: effectiveTake,
      });
      if (page.invalidCursor) {
        return failure({
          type: 'VALIDATION_ERROR',
          field: 'cursor',
          message: 'Invalid cursor',
        });
      }
      return success({
        threads: await toAdminThreadListItems(page.pageItems),
        nextCursor: page.nextCursor,
      });
    }

    const whereClause = buildAdminThreadWhere(filters);

    // DECISION (nie usuwaj tego komentarza) — finding support-1, parytet z user-endpointem
    // (getSupportThreads_IO): format-gate + existence-fallback cursora przez WSPÓLNY helper
    // resolveSupportThreadCursor (SSOT, support-cursor.helper.ts). Wcześniej admin używał
    // cursora BEZ tych dwóch zabezpieczeń: null-byte/non-cuid → niezmapowany 500, a
    // well-formed-but-unknown cursor → cicha pusta strona (200) zamiast złożenia do pierwszej.
    // `invalid` => VALIDATION_ERROR 400; `useCursor` => czy w ogóle aplikować Prisma
    // cursor-spread (existence-check w TYM SAMYM filtrze co główne query). Pełna rationale
    // (anti-enumeration, server-issued cursors) w helperze.
    const cursorState = await resolveSupportThreadCursor(cursor, whereClause);
    if (cursorState.invalid) {
      return failure({
        type: 'VALIDATION_ERROR',
        field: 'cursor',
        message: 'Invalid cursor',
      });
    }

    const threads = await DB_CLIENT.use.supportThread.findMany({
      where: whereClause,
      orderBy: { id: 'desc' },
      take: effectiveTake + 1,
      ...(cursor && cursorState.useCursor
        ? { cursor: { id: cursor }, skip: 1 }
        : {}),
      // Preview + licznik wiadomości poza tym zapytaniem (patrz niżej): zagnieżdżone
      // `messages.take` Prisma tnie dopiero w Node, a relacyjny `_count` to nieskorelowany
      // GROUP BY po całej tabeli. Rationale: support-thread-aggregates.helper.ts.
      select: ADMIN_THREAD_ROW_SELECT,
    });

    const hasMore = threads.length > effectiveTake;
    const pageItems = hasMore ? threads.slice(0, effectiveTake) : threads;
    const nextCursor =
      hasMore && pageItems.length > 0
        ? (pageItems[pageItems.length - 1]?.id ?? null)
        : null;

    return success({
      threads: await toAdminThreadListItems(pageItems),
      nextCursor,
    });
  } catch (error) {
    return databaseFailure('adminGetAllThreads_IO', error);
  }
};

// ── Admin Reply ──

type AdminReplyParams = {
  threadId: string;
  content: string;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
};

type AdminReplyResult = {
  message_id: string;
  user_email: string;
  subject: string;
};

export const adminReplyToThread_IO = async (
  params: AdminReplyParams
): Promise<
  OperationResult<
    AdminReplyResult,
    | SupportThreadNotFoundError
    | SupportThreadClosedError
    | DatabaseError
    | AdminInsufficientPermissionsError
  >
> => {
  const { threadId, content, currentUser } = params;

  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // DECISION (nie usuwaj tego komentarza) — concurrency lost-update (finding support-1):
    // TEN SAM pesymistyczny row-lock (lockSupportThreadRow = FOR UPDATE) co add-message /
    // change-status, jako PIERWSZY krok tx — wymaga tego KONTRAKT CROSS-FILE z
    // support-thread-lock.helper.ts. Admin reply warunkowo reopenuje (RESOLVED->OPEN); bez
    // wspólnego locka ten reopen mógłby przegrać wyścig z równoległym change-status->CLOSED
    // (last-writer-wins na kolumnie status) albo nadpisać świeży stan. Lock serializuje
    // wszystkich piszących ten wiersz. user.email czytamy PO locku (ta sama tx, spójny odczyt);
    // status/subject bierzemy z zablokowanego wiersza (helper je zwraca).
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      const locked = await lockSupportThreadRow(tx, threadId);

      if (locked === null) {
        return { ok: false as const, error: 'NOT_FOUND' as const };
      }

      // DECISION (nie usuwaj tego komentarza) — admin reply do CLOSED (finding R1):
      // CLOSED to stan finalny — wątek zamknięty MUSI być odrzucony PRZED create, dokładnie
      // jak user-side addSupportMessage_IO (mirror guard). Wcześniej guard CLOSED był NIEOBECNY:
      // admin dodawał wiadomość do CLOSED, status zostawał CLOSED (user widzi ClosedBanner i nie
      // może odpowiedzieć), a notyfikacja zapraszała do kontynuacji wątku, którego user nie wznowi.
      // Return value z callbacka $transaction = commit (tylko throw robi rollback), więc guard
      // MUSI być przed tx.supportMessage.create — inaczej ghost-message ląduje w CLOSED i liczy
      // się w _count.messages mimo {ok:false}. Pod row-lockiem ten odczyt widzi skommitowany
      // stan konkurenta (admin-close, który wygrał wyścig o lock, jest tu prawidłowo wykryty).
      if (locked.status === SupportThreadStatusValue.CLOSED) {
        return { ok: false as const, error: 'CLOSED' as const };
      }

      // SupportThread.user_id = soft-FK (FAZA C): email właściciela rozwiązujemy
      // po locked.user_id (lock zwraca user_id, istnienie wątku już potwierdzone powyżej).
      // Osierocony wątek (user po MOVE) => owner null => userEmail '' (reply się zapisze, notyfikacja padnie).
      const owner = await tx.user.findUnique({
        where: { id: locked.user_id },
        select: { email: true },
      });

      const message = await tx.supportMessage.create({
        data: {
          thread_id: threadId,
          sender_type: SupportSenderTypeValue.SUPPORT,
          content,
        },
        select: { id: true },
      });

      // DECISION (nie usuwaj tego komentarza) — OCC token symetria (closing-review finding
      // support-admin-occ-asymmetry): ZAWSZE touch wątku (bump SupportThread.updated_at) przy
      // KAŻDEJ odpowiedzi admina, nie tylko przy RESOLVED->OPEN reopen. status jest tu OPEN albo
      // RESOLVED (CLOSED odrzucony wyżej); ustawienie OPEN bezwarunkowo = reopen dla RESOLVED +
      // czysty bump updated_at dla OPEN (Prisma emituje UPDATE z @updatedAt=now() mimo braku zmiany
      // wartości). Bez tego OCC-token był ASYMETRYCZNY: świeża odpowiedź admina-B do OPEN wątku NIE
      // bumpowała updated_at, więc stale close admina-A (Signal 2: updated_at=expected) przechodził i
      // grzebał odpowiedź admina-B w CLOSED. Symetryczne z always-bump user-msg (addSupportMessage_IO).
      await tx.supportThread.update({
        where: { id: threadId },
        data: { status: SupportThreadStatusValue.OPEN },
      });

      return {
        ok: true as const,
        messageId: message.id,
        userEmail: owner?.email ?? '',
        subject: locked.subject,
      };
    });

    if (!txResult.ok) {
      if (txResult.error === 'CLOSED') {
        return failure({ type: 'SUPPORT_THREAD_CLOSED', threadId });
      }
      return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
    }

    return success({
      message_id: txResult.messageId,
      user_email: txResult.userEmail,
      subject: txResult.subject,
    });
  } catch (error) {
    return supportDbFailure(error, {
      namespace: 'SUPPORT_ADMIN_REPLY_ERROR',
      prefix: 'Failed to reply to support thread',
      operation: 'adminReplyToThread',
      payload: { threadId },
    });
  }
};

// ── Admin Change Status ──

type ChangeStatusParams = {
  threadId: string;
  status: SupportThreadStatus;
  currentUser: GetCurrentUserOutputOptimistic['currentUser'];
  // Optimistic-concurrency token (finding support-1): the thread `updated_at` the
  // admin last saw. When provided, the status change becomes CONDITIONAL — a fresh
  // user reply that arrived after this snapshot rejects the (stale) close. Absent OR
  // null => unconditional change (backward-compat, no guard). ISO 8601 string or Date.
  // `| undefined` is explicit (exactOptionalPropertyTypes) so the handler can pass the
  // optional DTO field straight through without omitting the key when absent.
  // `| null` (finding support-l2-2): JSON `null` realnie dociera z body (validator pomija
  // null jako "absent"); helper applySupportStatusWrite normalizuje null≡undefined.
  expectedUpdatedAt?: string | Date | null | undefined;
};

type ChangeStatusResult = {
  thread_id: string;
  status: SupportThreadStatus;
  // support-2: true gdy transition byl no-op (status docelowy == biezacy). applySupportStatusWrite
  // pomija wtedy DB-write; handler pomija audit-event (EventLog). Response zostaje 200 idempotent.
  noop: boolean;
};

// DECISION (nie usuwaj tego komentarza) — concurrency lost-update (finding support-1),
// USER-FIRST residual: this error is the OPTIMISTIC-concurrency conflict raised when an
// admin tries to close/transition a thread against a STALE snapshot (a user replied after
// the admin loaded their view). It is INTENTIONALLY local to this operation, NOT in the
// shared-kernel SupportError union yet: the kernel surface (DTO field + validator) is done,
// but the matching domain-error type + dedicated INFO event + error-mapper case are a
// pending kernel follow-up (see report support-1). The handler maps this case to 409 Conflict
// directly (respondConflict + APP_EVENTS.INFO.APPLICATION.ALREADY_PROCESSED) and narrows it
// OUT before mapErrorToResponse, so the central exhaustive mapper still compiles unchanged.
// Once the kernel absorbs this type, move it to support-errors.types.ts + add an error-mapper
// case and drop the handler's local narrow.
export type SupportThreadStaleError = {
  type: 'SUPPORT_THREAD_STALE';
  threadId: string;
};

export const adminChangeThreadStatus_IO = async (
  params: ChangeStatusParams
): Promise<
  OperationResult<
    ChangeStatusResult,
    | SupportThreadNotFoundError
    | SupportThreadStaleError
    | DatabaseError
    | AdminInsufficientPermissionsError
  >
> => {
  const { threadId, status, currentUser, expectedUpdatedAt } = params;

  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // DECISION (nie usuwaj tego komentarza) — concurrency lost-update (finding support-1):
    // Bierzemy TEN SAM pesymistyczny row-lock (lockSupportThreadRow = SELECT ... FOR UPDATE)
    // co addSupportMessage_IO, PRZED zmianą statusu. To była brakująca połowa fixu: wcześniej
    // był tu findUnique BEZ locka, więc obie transakcje czytały OPEN współbieżnie i OBIE
    // commitowały (msg + CLOSED) -> wiadomość uwięziona w CLOSED, 14/14. FOR UPDATE po OBU
    // stronach USUWA współbieżny double-commit i serializuje pisarzy tego wiersza:
    //  - admin-first: admin zamyka, potem add-message bierze lock, widzi CLOSED -> ODRZUCA
    //    wiadomość (nie trapuje). To jest poprawione tutaj.
    //  - user-first: add-message wstawia do OPEN (legalnie) i commituje, POTEM ten close
    //    commituje CLOSED -> end-state CLOSED+msg. To jest LEGALNA serializacja "msg-then-close",
    //    ale łamie twardy invariant findingu ("żadnej user-msg w CLOSED"). Sam lock NIE może
    //    tego cofnąć (wiadomość już zacommitowana, zanim close zdążył ją zobaczyć).
    // PEŁNE domknięcie user-first wymaga optimistic-concurrency: gdy admin poda
    // expectedUpdatedAt (stan, który widział), applySupportStatusWrite odrzuca close, jeśli
    // wątek zmienił się od snapshotu (świeża USER-msg lub bump updated_at) — pełna rationale
    // i DWA sygnały staleness w support-status-write.helper.ts. Lock MUSI być wzięty PRZED
    // helperem (ta sama tx) i zastępuje findUnique jako existence-check (NULL = brak wątku).
    // expectedUpdatedAt = pole REQUEST DTO + validator (shared-kernel) + przekazanie z handlera.
    const txResult = await DB_CLIENT.use.$transaction<
      | { ok: true; noop?: true }
      | { ok: false; reason: 'NOT_FOUND' }
      | { ok: false; reason: 'STALE' }
    >(async tx => {
      const locked = await lockSupportThreadRow(tx, threadId);

      if (locked === null) {
        return { ok: false, reason: 'NOT_FOUND' };
      }

      // NOT_FOUND handled above; helper returns { ok:true } | { ok:false; reason:'STALE' }.
      return applySupportStatusWrite(tx, threadId, status, expectedUpdatedAt);
    });

    if (!txResult.ok) {
      if (txResult.reason === 'STALE') {
        return failure({ type: 'SUPPORT_THREAD_STALE', threadId });
      }
      return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
    }

    // support-2: skip the audit log for no-op transitions (e.g. CLOSED->CLOSED).
    // The helper already suppressed the redundant DB write and signals it via
    // `noop`; gating the audit here removes the cosmetic "status changed" noise
    // while the response stays a 200 idempotent success.
    const isNoop = txResult.noop === true;
    if (!isNoop) {
      reportIssueBackend({
        namespace: 'SUPPORT_STATUS_CHANGED',
        message: `Support thread ${threadId} status changed to ${status}`,
        payload: { threadId, status },
        mode: 'info',
      });
    }

    return success({ thread_id: threadId, status, noop: isNoop });
  } catch (error) {
    return supportDbFailure(error, {
      namespace: 'SUPPORT_CHANGE_STATUS_ERROR',
      prefix: 'Failed to change support thread status',
      operation: 'adminChangeThreadStatus',
      payload: { threadId, status },
    });
  }
};

// ── Admin Get Thread Messages ──

// DECISION (nie usuwaj tego komentarza) — success payload zwiazany bezposrednio z
// kontraktem API (SUPPORT_ADMIN_GET_THREAD_MESSAGES RESPONSE), nie lokalnym typem: DTO
// rozszerza user-owa RESPONSE o thread.updated_at (token optimistic-concurrency, finding
// support-1) — admin UI odsyla go jako CHANGE_STATUS.expected_updated_at, by stale close
// (user odpisal po zaladowaniu widoku) dostal 409. Wiazanie do DTO wymusza obecnosc
// updated_at end-to-end (handler bindowany tym samym DTO), zamiast pozwalac mu wyciekac
// poza kontrakt RESPONSE.
export const adminGetThreadMessages_IO = async (
  threadId: string,
  currentUser: GetCurrentUserOutputOptimistic['currentUser']
): Promise<
  OperationResult<
    SUPPORT_DTO_API_V1['SUPPORT_ADMIN_GET_THREAD_MESSAGES']['RESPONSE'],
    | SupportThreadNotFoundError
    | DatabaseError
    | AdminInsufficientPermissionsError
  >
> => {
  const adminCheck = requireAdminPermission(currentUser);
  if (!adminCheck.success) {
    return adminCheck;
  }

  try {
    // DD3-F10 (2026-05-26): cap nested messages at 200. Pathological threads (long-running
    // conversation, abuse, runaway bot) would otherwise pull thousands of messages into
    // memory + payload. 200 covers >99% of real cases; UI can paginate older messages on demand.
    // DECISION (nie usuwaj tego komentarza): przy obcięciu do 200 admin MUSI widzieć
    // NAJNOWSZE 200 (desc + reverse), dokładnie tak jak user-side getSupportThreadMessages_IO.
    // Wcześniej było tu `asc` + take:200, więc na długim wątku operator czytał NAJSTARSZE
    // 200 wiadomości, a użytkownik najnowsze — obie strony dosłownie patrzyły na inne połowy
    // rozmowy, a odpowiedź admina dotyczyła wątku sprzed setek wiadomości. Pobieramy DESC
    // (aktywny ogon) i odwracamy przed mapowaniem, żeby payload został chronologiczny (ASC).
    const thread = await DB_CLIENT.use.supportThread.findUnique({
      where: { id: threadId },
      select: {
        id: true,
        subject: true,
        category: true,
        status: true,
        updated_at: true,
        user_id: true,
        messages: {
          orderBy: { created_at: 'desc' },
          take: 200,
          select: {
            id: true,
            thread_id: true,
            sender_type: true,
            content: true,
            created_at: true,
          },
        },
      },
    });

    if (!thread) {
      return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
    }

    // Tozsamosc autora watku. `user_id` jest soft-FK (konto mogло zostac
    // usuniete albo przeniesione po 90 dniach), wiec rozwiazujemy je OSOBNYM
    // zapytaniem i akceptujemy brak wiersza — dokladnie ta sama zasada, co
    // w hydrateAdminThreadListItems dla listy watkow. Pusty string zamiast null,
    // bo DTO obiecuje string, a UI ma wlasny fallback na "Klient".
    const owner = await DB_CLIENT.use.user.findUnique({
      where: { id: thread.user_id },
      select: { email: true, name: true },
    });

    // Pobrane DESC (najnowsze 200) — odwracamy do chronologicznego ASC dla frontendu.
    return success({
      messages: thread.messages
        .slice()
        .reverse()
        .map(m => ({
          id: m.id,
          thread_id: m.thread_id,
          sender_type: assertType(
            m.sender_type,
            isSupportSenderTypeNarrower,
            'SupportMessage.sender_type'
          ),
          content: m.content,
          created_at: m.created_at,
        })),
      thread: {
        id: thread.id,
        subject: thread.subject,
        category: thread.category,
        status: assertType(
          thread.status,
          isSupportThreadStatusNarrower,
          'SupportThread.status'
        ),
        updated_at: thread.updated_at,
        user_email: owner?.email ?? '',
        user_name: owner?.name ?? '',
      },
    });
  } catch (error) {
    return supportDbFailure(error, {
      namespace: 'SUPPORT_ADMIN_GET_MESSAGES_ERROR',
      prefix: 'Failed to get thread messages (admin)',
      operation: 'adminGetThreadMessages',
      payload: { threadId },
    });
  }
};
