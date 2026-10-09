/**
 * Support Thread Operations — User-facing (WRITE)
 *
 * - createSupportThread_IO: Creates thread + first message + admin alert
 * - addSupportMessage_IO: Adds message to existing thread
 *
 * Read operations (list threads, list messages) live in
 * support-thread-queries.operations.ts.
 */

import { DB_CLIENT } from '@app/db/db.client';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { isSerializationConflict } from '@app/db/serialization-conflict';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { TIME } from '@kernel/application/constants.config';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type {
  DatabaseError,
  SerializationConflictError,
} from '@kernel/application/common-errors.types';
import type {
  SupportThreadNotFoundError,
  SupportThreadNotAuthorizedError,
  SupportThreadClosedError,
  SupportRateLimitedError,
} from '@kernel/domain/support/support-errors.types';
import {
  SupportSenderTypeValue,
  SupportThreadStatusValue,
} from '@kernel/models/support/support.dto';
import type { SupportThreadCategory } from '@kernel/models/support/support.dto';
import { deriveSupportSubject } from '@domain/support/support-subject.resolver';
import { lockUserRow } from '@app/db/lock-rows';
import { lockSupportThreadRow } from './support-thread-lock.helper';

// DECISION (nie usuwaj tego komentarza) — per-user hourly quota (finding support-spam-flood):
// Support create-thread / add-message NIE miały żadnego rate-limitu: jeden authed user mógł
// tworzyć nieograniczoną liczbę wątków i wiadomości, KAŻDA planująca bezwarunkowy fire-and-forget
// admin-alert email (runAfterResponse w create-thread/add-message index.ts) -> spam + email-flood.
// Domykamy tym samym wzorcem co rodzeństwo user-content-submission (moderation-report.operation.ts
// 5/h, share-session shares-per-hour): count-w-oknie -> failure. Progi LOKALNE w web-1 (jak
// REPORT_RATE_LIMIT w moderation-report), bo SSOT limitów (PLATFORM_LIMITS, pricing.policy.ts)
// żyje w .shared-kernel -> patrz needsKernel (docelowo SUPPORT_THREAD/MESSAGE_RATE_LIMIT tam +
// dedykowany SupportRateLimitedError). Threads niżej niż messages: nowy wątek = nowy admin-alert
// + queue-inflacja, więc twardsza granica; wiadomości do istniejącego wątku = tańsze.
const SUPPORT_THREAD_RATE_LIMIT = 5; // threads per hour per user
const SUPPORT_MESSAGE_RATE_LIMIT = 30; // USER messages per hour per user
const RATE_LIMIT_WINDOW_MS = TIME.MS_PER_HOUR;

// ── Create Thread ──

type CreateThreadParams = {
  userId: string;
  category: SupportThreadCategory;
  firstMessage: string;
};

type CreateThreadResult = {
  thread_id: string;
  /** Title derived from the first message; the admin alert mail needs it. */
  subject: string;
};

export const createSupportThread_IO = async (
  params: CreateThreadParams
): Promise<
  OperationResult<
    CreateThreadResult,
    DatabaseError | SerializationConflictError | SupportRateLimitedError
  >
> => {
  const { userId, category, firstMessage } = params;
  // The request carries no subject since S126 (see deriveSupportSubject).
  const subject = deriveSupportSubject(firstMessage);

  try {
    // DECISION (nie usuwaj tego komentarza) — rate-limit TOCTOU (finding support-spam-flood):
    // count(threads w ostatniej godzinie) + create owinięte w SERIALIZABLE transakcję. Pod READ
    // COMMITTED N równoległych create'ów przy count=4 wszystkie widzą 4<5 i commitują -> breach
    // (zweryfikowane: 25 parallel = 25×201). Pod Serializable pre-check count() staje się punktem
    // serializacji (SIReadLock na zliczanym zakresie), więc requesty które wszystkie odczytają
    // "pod limitem" i każdy wstawi wątek do tego zakresu tworzą rw-antidependency -> Postgres
    // aborbuje przegranych z 40001. Efekt: NIGDY > SUPPORT_THREAD_RATE_LIMIT commituje. Wzorzec
    // 1:1 z moderation-report.operation.ts.
    return await DB_CLIENT.use.$transaction(
      async tx => {
        const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
        const recentThreadCount = await tx.supportThread.count({
          where: { user_id: userId, created_at: { gte: oneHourAgo } },
        });

        if (recentThreadCount >= SUPPORT_THREAD_RATE_LIMIT) {
          reportIssueBackend({
            namespace: 'SUPPORT_RATE_LIMITED',
            message: `User ${userId} exceeded support thread rate limit: ${recentThreadCount}/${SUPPORT_THREAD_RATE_LIMIT} in last hour`,
            payload: { userId, currentCount: recentThreadCount },
            mode: 'info',
          });
          return failure({
            type: 'SUPPORT_RATE_LIMITED' as const,
            currentCount: recentThreadCount,
            limit: SUPPORT_THREAD_RATE_LIMIT,
          });
        }

        const thread = await tx.supportThread.create({
          data: {
            user_id: userId,
            subject,
            category,
            messages: {
              create: {
                sender_type: SupportSenderTypeValue.USER,
                content: firstMessage,
              },
            },
          },
          select: { id: true },
        });

        reportIssueBackend({
          namespace: 'SUPPORT_THREAD_CREATED',
          message: `Support thread created: ${thread.id} by user ${userId}`,
          payload: { threadId: thread.id, category },
          mode: 'info',
        });

        return success({ thread_id: thread.id, subject });
      },
      { isolationLevel: 'Serializable' }
    );
  } catch (error) {
    // 40001 = współbieżny create PRZEGRAŁ wyścig o rate-limit pod Serializable (tx zrollowana,
    // wątek NIE dołożony -> limit trzyma). Retryable 429 (isSerializationConflict, NIE sam P2034
    // — pod adapter-pg 40001 wychodzi jako DriverAdapterError bez .code). Wzorzec: moderation-report.
    if (isSerializationConflict(error)) {
      reportIssueBackend({
        namespace: 'SUPPORT_RATE_LIMITED',
        message: `Support create-thread serialization conflict for user ${userId} — rolled back (retryable 429). Limit: ${SUPPORT_THREAD_RATE_LIMIT}`,
        payload: { userId, limit: SUPPORT_THREAD_RATE_LIMIT },
        mode: 'info',
      });
      return failure({ type: 'SERIALIZATION_CONFLICT' });
    }
    return databaseFailure('createSupportThread', error);
  }
};

// ── Add Message ──

type AddMessageParams = {
  userId: string;
  threadId: string;
  content: string;
};

type AddMessageResult = {
  message_id: string;
  subject: string;
};

export const addSupportMessage_IO = async (
  params: AddMessageParams
): Promise<
  OperationResult<
    AddMessageResult,
    | SupportThreadNotFoundError
    | SupportThreadNotAuthorizedError
    | SupportThreadClosedError
    | SupportRateLimitedError
    | DatabaseError
  >
> => {
  const { userId, threadId, content } = params;

  try {
    // Wrap ownership check + message insert + status update in one transaction
    // so concurrent requests cannot observe partial state (e.g. message inserted
    // against a thread whose status update lost a race).
    const txResult = await DB_CLIENT.use.$transaction(async tx => {
      // DECISION (nie usuwaj tego komentarza) — per-user cap HARD-ening (closing-review finding
      // support-msg-softcap): lock wiersza USERA (FOR UPDATE) PRZED lockSupportThreadRow. Kolejność
      // User -> SupportThread = zgodna z globalnym inwariantem (User najniższy, SupportThread
      // najwyższy) -> zero ABBA. Bez tego locka message-cap był SOFT: równoległe wiadomości do
      // RÓŻNYCH wątków tego samego usera (per-thread lock ich NIE serializuje) czytały stale
      // count<limit i wszystkie commitowały -> burst ponad 30/h + admin-email-flood (KAŻDA msg =
      // sendSupportNewMessageAdminAlert). User-lock serializuje WSZYSTKIE message-addy tego usera
      // (cross-thread), więc count staje się autorytatywny i cap jest TWARDY. lockSupportThreadRow
      // niżej nadal chroni lost-update statusu wątku (TOCTOU z admin-close).
      await lockUserRow(tx, userId);

      // DECISION (nie usuwaj tego komentarza) — concurrency lost-update (finding support-1):
      // PESYMISTYCZNY row-lock (FOR UPDATE) ZANIM przeczytamy status i wstawimy wiadomość.
      // Bez locka, na Read Committed, równoległy admin change-status->CLOSED commituje MIĘDZY
      // odczytem statusu a INSERT-em -> wiadomość ląduje w CLOSED wątku (TOCTOU), niewidoczna
      // w admin OPEN-queue. Pełna rationale + KONTRAKT CROSS-FILE (adminChangeThreadStatus_IO
      // i adminReplyToThread_IO MUSZĄ brać TEN SAM lock) -> support-thread-lock.helper.ts.
      // Pessimistic lock działa tylko, gdy biorą go WSZYSCY piszący ten wiersz.
      const locked = await lockSupportThreadRow(tx, threadId);

      if (locked === null) {
        return { ok: false as const, error: 'NOT_FOUND' as const };
      }

      if (locked.user_id !== userId) {
        return { ok: false as const, error: 'NOT_AUTHORIZED' as const };
      }

      // DECISION (nie usuwaj tego komentarza):
      // Wszystkie guardy MUSZĄ być PRZED create. Return value z callbacka
      // $transaction = commit (tylko throw robi rollback). Gdyby create był
      // przed guardem CLOSED, ghost message zostałby zapisany w zamkniętym
      // wątku i policzony w _count.messages mimo zwrotu {ok:false}.
      // Pod row-lockiem ten odczyt widzi już skommitowane zmiany konkurenta,
      // więc admin-close, który wygrał wyścig o lock, jest tu prawidłowo wykryty.
      if (locked.status === SupportThreadStatusValue.CLOSED) {
        return { ok: false as const, error: 'CLOSED' as const };
      }

      // DECISION (nie usuwaj tego komentarza) — per-user message quota (finding support-spam-flood):
      // cap USER-msgs na SUPPORT_MESSAGE_RATE_LIMIT/h/user (across all wątków usera). Count liczony pod
      // lockUserRow (FOR UPDATE na wierszu usera, wzięty na starcie tx) -> WSZYSTKIE message-addy tego
      // usera serializują się cross-thread, więc count jest AUTORYTATYWNY i cap TWARDY (nie soft — patrz
      // User-lock DECISION wyżej; wcześniejszy per-thread lock serializował tylko jeden wątek, przez co
      // burst do wielu wątków przekraczał cap). Pod Read Committed + User-lock: kolejny writer czeka na
      // commit poprzednika i widzi jego msg w count.
      const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
      const recentMessageCount = await tx.supportMessage.count({
        where: {
          sender_type: SupportSenderTypeValue.USER,
          created_at: { gte: oneHourAgo },
          thread: { user_id: userId },
        },
      });

      if (recentMessageCount >= SUPPORT_MESSAGE_RATE_LIMIT) {
        reportIssueBackend({
          namespace: 'SUPPORT_RATE_LIMITED',
          message: `User ${userId} exceeded support message rate limit: ${recentMessageCount}/${SUPPORT_MESSAGE_RATE_LIMIT} in last hour`,
          payload: { userId, threadId, currentCount: recentMessageCount },
          mode: 'info',
        });
        return {
          ok: false as const,
          error: 'RATE_LIMITED' as const,
          currentCount: recentMessageCount,
        };
      }

      const message = await tx.supportMessage.create({
        data: {
          thread_id: threadId,
          sender_type: SupportSenderTypeValue.USER,
          content,
        },
        select: { id: true },
      });

      // DECISION (nie usuwaj tego komentarza) — OCC token freshness (finding support-occ-open-open):
      // ZAWSZE touch wiersza wątku (bump SupportThread.updated_at = @updatedAt) przy KAŻDEJ user-msg,
      // nie tylko przy zmianie statusu. Poprzedni gate `status !== OPEN` był KORZENIEM buga: świeża
      // odpowiedź usera do JUŻ-OPEN wątku NIE bumpowała updated_at, więc admin OCC-snapshot (Signal 2
      // w applySupportStatusWrite: updateMany WHERE updated_at=expected) wciąż matchował stary updated_at
      // -> stale CLOSE przechodził (200) i uwięził świeżą user-msg w CLOSED (user zablokowany guardem
      // SUPPORT_THREAD_CLOSED). Bezwarunkowy update sprawia, że updated_at = "ostatnia aktywność"
      // (status-change LUB user-reply), więc Signal 2 wykrywa KAŻDĄ świeżą odpowiedź i odrzuca
      // przeterminowany close (409). Gate NIE miał legalnego powodu: listy (user getSupportThreads_IO +
      // admin adminGetAllThreads_IO) sortują po `id desc`, NIE po updated_at, więc bump nie zaburza
      // kolejności; jedynym konsumentem updated_at jest OCC-token, dla którego "last activity" to
      // POPRAWNA semantyka. Prisma emituje UPDATE (z @updatedAt=now()) także gdy status==OPEN (brak
      // change-detection na wartości), więc touch działa dla OPEN->OPEN. Reopen RESOLVED->OPEN zachowany
      // (ta sama linia ustawia OPEN), pod FOR UPDATE lockiem atomowo — reopen-race protection nietknięta.
      await tx.supportThread.update({
        where: { id: threadId },
        data: { status: SupportThreadStatusValue.OPEN },
      });

      return {
        ok: true as const,
        messageId: message.id,
        subject: locked.subject,
      };
    });

    if (!txResult.ok) {
      if (txResult.error === 'NOT_FOUND') {
        return failure({ type: 'SUPPORT_THREAD_NOT_FOUND', threadId });
      }
      if (txResult.error === 'CLOSED') {
        return failure({ type: 'SUPPORT_THREAD_CLOSED', threadId });
      }
      if (txResult.error === 'RATE_LIMITED') {
        return failure({
          type: 'SUPPORT_RATE_LIMITED',
          currentCount: txResult.currentCount,
          limit: SUPPORT_MESSAGE_RATE_LIMIT,
        });
      }
      return failure({
        type: 'SUPPORT_THREAD_NOT_AUTHORIZED',
        threadId,
        userId,
      });
    }

    return success({
      message_id: txResult.messageId,
      subject: txResult.subject,
    });
  } catch (error) {
    return databaseFailure('addSupportMessage', error);
  }
};
