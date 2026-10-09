/**
 * Messaging write operations — sendMessage_IO, markRead_IO,
 * setConversationHidden_IO (D2: ukryj / przywróć).
 *
 * Wysyłka: party-gate (resolvePairSide) + PENDING/ACTIVE-gate (canSendToPair) +
 * per-user godzinowy rate-limit, wszystko w SERIALIZABLE tx (count() = punkt
 * serializacji → cap TWARDY bez explicit-locków, parytet createSupportThread_IO).
 * Wysyłka bumpuje last_message_at + oznacza WŁASNĄ stronę jako przeczytaną.
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
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import {
  StylistClientMessageSenderValue,
  type MessagingMessageDTO,
  type StylistClientMessageSender,
} from '@kernel/models/messaging/messaging.dto';
import {
  AccountStatusValue,
  type AccountStatus,
  type PairingStatus,
} from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { resolvePairSide, canSendToPair } from '../messaging.helpers';

/**
 * DECISION (nie usuwaj tego komentarza):
 * Live-surface counterpart-visibility mask (SSOT: pairing-query.operations.ts
 * getMyPairs_IO; lustrzana kopia w messaging-query.operations.ts). Zdjęty /
 * soft-deleted counterpart (para zostaje ACTIVE per Model A, DOMAIN_SSOT §13.1)
 * NIE może być adresatem ŻADNEGO write'a — ani wysyłki (write-into-void: odbiorca
 * jest wylogowany i tego nie przeczyta), ani mark-read (para jest zamaskowana na
 * powierzchni odczytu, więc zapis watermarku dotyczyłby wątku, którego wołający
 * nie ma prawa widzieć — dawał existence-oracle: 204 dla „ghost-pary", 404 dla
 * cudzej). Werdykt = ten sam co nie-strona (MESSAGING_PAIR_NOT_FOUND,
 * anti-enumeration parity). Predykat trzymamy w JEDNYM miejscu — markRead_IO
 * miał go wcześniej pominięty (guard-parity oversight) i regresja polega właśnie
 * na kopiowaniu bramki per-operacja. Live-surface-masks, archive-retains;
 * odwracalne po re-enable counterparta.
 */
const isCounterpartInactive = (
  side: StylistClientMessageSender,
  pair: {
    client_user: { is_active: boolean } | null;
    stylist_account: { account_status: AccountStatus } | null;
  }
): boolean =>
  side === StylistClientMessageSenderValue.CLIENT
    ? pair.stylist_account?.account_status !== AccountStatusValue.ACTIVE
    : pair.client_user?.is_active === false;

const MESSAGING_RATE_LIMIT = 60; // wiadomości / godzinę / user (czat luźniejszy niż support)
const RATE_LIMIT_WINDOW_MS = TIME.MS_PER_HOUR;
// Throttle notyfikacji: jeśli ten sam nadawca wysłał coś do tej pary w ostatnich
// 15 min, kolejna wiadomość NIE wysyła e-maila (burst back-and-forth = 1 mail).
const NOTIFY_THROTTLE_MS = 15 * TIME.MS_PER_MINUTE;
// DECISION (nie usuwaj tego komentarza) — 2026-09-25, dedup podwójnego wysłania:
// ten sam nadawca (ta sama strona pary) + ta sama para + IDENTYCZNA treść w ciągu
// tego okna = jedno wysłanie powtórzone (podwójny tap, ponowienie po zerwanym
// połączeniu). Oddajemy istniejącą wiadomość z tym samym sukcesem, bez drugiego
// wiersza i bez powiadomienia. Okno jest krótkie celowo: świadome „ok" / „dzięki"
// wysłane drugi raz po chwili jest normalną rozmową i musi przejść. Sprawdzenie
// jest w tej samej SERIALIZABLE tx co insert: dwa równoległe bliźniaki czytają
// ten sam predykat i piszą w niego, więc jeden dostaje 40001, a wewnętrzny retry
// niżej widzi już zatwierdzony wiersz pierwszego i trafia w tę gałąź.
export const MESSAGE_DEDUP_WINDOW_MS = 5_000;

export type SendMessageResult = {
  message: MessagingMessageDTO;
  /** User do powiadomienia e-mailem (druga strona), albo null gdy throttled. */
  notifyRecipientUserId: string | null;
  /** Strona nadawcy w TEJ parze — handler dobiera po niej nazwę do notyfikacji
   *  (CLIENT → imię osobiste; STYLIST → nazwa biznesowa). Bez tego user będący
   *  jednocześnie stylistką i klientką, piszący jako CLIENT, wyciekłby swoją
   *  nazwę biznesową odbiorcy (closing-review LOW). */
  senderSide: StylistClientMessageSender;
  /** Status pary — e-mail fallback senderName TYLKO dla ACTIVE (PII-minimum
   *  pre-accept: "email dopiero po ACCEPT", closing-review S82). */
  pairStatus: PairingStatus;
};

export const sendMessage_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  content: string;
}): Promise<
  OperationResult<
    SendMessageResult,
    MessagingError | DatabaseError | SerializationConflictError
  >
> => {
  const { currentUser, pairId, content } = params;

  // S82: auto-mark-read odbiorcy pisze TEN SAM wiersz pary poza tx i odpala
  // się dokładnie przy nadejściu wiadomości (aktywny ping-pong) → 40001 jest
  // skorelowany ze zwykłym użyciem, nie z anomalią. Jeden wewnętrzny retry
  // zdejmuje klasę z usera (tx wycofany = retry bezpieczny, zero podwójnego
  // create); po 2. konflikcie 429 zostaje jako retryable wyjście.
  const MAX_TX_ATTEMPTS = 2;
  for (let attempt = 1; attempt <= MAX_TX_ATTEMPTS; attempt++) {
    try {
      return await DB_CLIENT.use.$transaction(
        async tx => {
          const pair = await tx.clientStylistPair.findUnique({
            where: { id: pairId },
            select: {
              id: true,
              client_user_id: true,
              stylist_account_id: true,
              status: true,
              stylist_hidden_at: true,
              client_hidden_at: true,
              client_user: { select: { is_active: true } },
              stylist_account: {
                select: {
                  created_by_user_id: true,
                  account_status: true,
                },
              },
            },
          });

          // Anti-enumeration: brak pary == nie-strona → jeden werdykt.
          if (pair == null) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }
          const side = resolvePairSide(pair, currentUser);
          if (side == null) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }

          if (isCounterpartInactive(side, pair)) {
            return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
          }

          if (!canSendToPair(pair.status)) {
            return failure({ type: 'MESSAGING_NOT_ALLOWED' as const });
          }

          const duplicate = await tx.stylistClientMessage.findFirst({
            where: {
              pair_id: pairId,
              sender_type: side,
              content,
              created_at: {
                gte: new Date(Date.now() - MESSAGE_DEDUP_WINDOW_MS),
              },
            },
            orderBy: { created_at: 'desc' },
            select: {
              id: true,
              sender_type: true,
              content: true,
              created_at: true,
            },
          });
          if (duplicate) {
            return success({
              message: duplicate,
              // Pierwsze wysłanie już (ewentualnie) powiadomiło odbiorcę.
              notifyRecipientUserId: null,
              senderSide: side,
              pairStatus: pair.status,
            });
          }

          // DECISION (nie usuwaj tego komentarza): cap liczy CZŁOWIEKA, nie stronę.
          // Wcześniej zakres zawężał się do strony, po której akurat leci wysyłka
          // (klientka: jej `client_user_id`; stylistka: jej konto), co dawało dwa
          // ROZŁĄCZNE kubełki. User z obiema rolami — a takich jest sporo, bo konto
          // klientki zakłada się jednym tapem — miał przez to podwójny limit:
          // zmierzone 60 wiadomości jako klientka (429) plus 60 jako stylistka (201)
          // w tej samej godzinie. Komentarz przy stałej mówi „na usera", więc to był
          // rozjazd z własną deklaracją, nie zamierzona ulga. Liczymy sumę obu stron
          // TEGO SAMEGO człowieka; cap pozostaje współdzielony między wszystkimi jego
          // rozmowami (to akurat działało poprawnie i jest sprawdzone).
          const oneHourAgo = new Date(Date.now() - RATE_LIMIT_WINDOW_MS);
          const isClient = side === StylistClientMessageSenderValue.CLIENT;
          const callerStylistAccountId =
            currentUser.stylist_account?.account_id ?? null;
          const sentByThisHuman = {
            created_at: { gte: oneHourAgo },
            OR: [
              {
                sender_type: StylistClientMessageSenderValue.CLIENT,
                pair: { client_user_id: currentUser.id },
              },
              ...(callerStylistAccountId !== null
                ? [
                    {
                      sender_type: StylistClientMessageSenderValue.STYLIST,
                      pair: { stylist_account_id: callerStylistAccountId },
                    },
                  ]
                : []),
            ],
          };
          const recentCount = await tx.stylistClientMessage.count({
            where: sentByThisHuman,
          });
          if (recentCount >= MESSAGING_RATE_LIMIT) {
            // Prawdziwy czas odblokowania: okno przesuwa się razem z NAJSTARSZĄ
            // wiadomością, którą jeszcze liczymy. Bez tego jedyną wskazówką dla
            // klienta były nagłówki limitera per-IP, opisujące zupełnie inne
            // (kilkunastosekundowe) okno — czyli zaproszenie do pętli ponowień.
            const oldestInWindow = await tx.stylistClientMessage.findFirst({
              where: sentByThisHuman,
              orderBy: { created_at: 'asc' },
              select: { created_at: true },
            });
            const unblocksAt =
              (oldestInWindow?.created_at.getTime() ?? Date.now()) +
              RATE_LIMIT_WINDOW_MS;
            const retryAfterSeconds = Math.max(
              1,
              Math.ceil((unblocksAt - Date.now()) / 1000)
            );
            reportIssueBackend({
              namespace: 'MESSAGING_RATE_LIMITED',
              message: `User ${currentUser.id} exceeded messaging rate limit: ${recentCount}/${MESSAGING_RATE_LIMIT} in last hour`,
              payload: {
                userId: currentUser.id,
                pairId,
                currentCount: recentCount,
              },
              mode: 'info',
            });
            return failure({
              type: 'MESSAGING_RATE_LIMITED' as const,
              retryAfterSeconds,
            });
          }

          // Throttle notyfikacji: czy ten nadawca pisał do tej pary w ostatnich 15 min?
          const throttleSince = new Date(Date.now() - NOTIFY_THROTTLE_MS);
          const recentFromSender = await tx.stylistClientMessage.count({
            where: {
              pair_id: pairId,
              sender_type: side,
              created_at: { gte: throttleSince },
            },
          });

          const now = new Date();
          // created_at JAWNIE z tego samego zegara aplikacji co last_message_at
          // i watermarki *_last_read_at (S82): schema @default(now()) brał zegar
          // BAZY, a unread porównuje created_at > myLastRead — skew app↔DB
          // przesuwał granicę unread (wiadomość mogła urodzić się "przed"
          // własnym bump'em pary albo "po" cudzym mark-read z przyszłości).
          const message = await tx.stylistClientMessage.create({
            data: {
              pair_id: pairId,
              sender_type: side,
              content,
              created_at: now,
            },
            select: {
              id: true,
              sender_type: true,
              content: true,
              created_at: true,
            },
          });

          // Bump last_message_at + oznacz WŁASNĄ stronę jako przeczytaną (nadawca
          // "przeczytał" do własnej wiadomości → jego unread = 0).
          await tx.clientStylistPair.update({
            where: { id: pairId },
            data: {
              last_message_at: now,
              ...(isClient
                ? { client_last_read_at: now }
                : { stylist_last_read_at: now }),
            },
          });

          const recipientUserId = isClient
            ? pair.stylist_account.created_by_user_id
            : pair.client_user_id;

          // DECISION (nie usuwaj tego komentarza) — D2 (2026-09-05), HIDE = MUTE:
          // gdy ODBIORCA ukrył tę rozmowę, żadne powiadomienie nie wychodzi —
          // ale wysyłka zwraca DOKŁADNIE ten sam sukces, wiadomość jest zapisana
          // i last_message_at bumpnięty jak zwykle (anty-oracle: nadawca nie
          // dowiaduje się, że został wyciszony; wątek NIE odkrywa się drugiej
          // stronie, bo lista filtruje znacznik, a nie go zeruje).
          const recipientHidden = isClient
            ? pair.stylist_hidden_at != null
            : pair.client_hidden_at != null;

          return success({
            message,
            notifyRecipientUserId:
              recentFromSender > 0 || recipientHidden ? null : recipientUserId,
            senderSide: side,
            pairStatus: pair.status,
          });
        },
        { isolationLevel: 'Serializable' }
      );
    } catch (error) {
      if (isSerializationConflict(error)) {
        if (attempt < MAX_TX_ATTEMPTS) {
          continue;
        }
        return failure({ type: 'SERIALIZATION_CONFLICT' });
      }
      return databaseFailure('sendMessage', error);
    }
  }
  // Nieosiągalne (pętla zawsze zwraca) — domknięcie dla TS.
  return failure({ type: 'SERIALIZATION_CONFLICT' });
};

export const markRead_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
}): Promise<
  OperationResult<
    { pair_id: string; read_at: Date },
    MessagingError | DatabaseError
  >
> => {
  const { currentUser, pairId } = params;

  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
        client_user: { select: { is_active: true } },
        stylist_account: { select: { account_status: true } },
      },
    });
    if (pair == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    const side = resolvePairSide(pair, currentUser);
    if (side == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    // Parytet bramek z sendMessage_IO — patrz DECISION przy isCounterpartInactive.
    if (isCounterpartInactive(side, pair)) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }

    const now = new Date();
    await DB_CLIENT.use.clientStylistPair.update({
      where: { id: pairId },
      data:
        side === StylistClientMessageSenderValue.CLIENT
          ? { client_last_read_at: now }
          : { stylist_last_read_at: now },
    });

    return success({ pair_id: pairId, read_at: now });
  } catch (error) {
    return databaseFailure('markRead', error);
  }
};

/**
 * D2 (2026-09-05): ukryj (`hidden=true`) / przywróć (`hidden=false`) rozmowę PO
 * STRONIE WOŁAJĄCEGO. Idempotentne (ponowne ukrycie zachowuje pierwotny
 * znacznik, ponowne przywrócenie = no-op).
 *
 * DECISION (nie usuwaj tego komentarza):
 * Bramka = WYŁĄCZNIE bycie stroną pary (resolvePairSide → MESSAGING_PAIR_NOT_FOUND
 * dla nie-strony i braku pary, anti-enumeration). ŚWIADOMIE bez bramki statusu
 * (PENDING/ACTIVE/REVOKED — ukrywać można w każdym stanie, także zamkniętą
 * historię po odmowie) i bez bramki żywotności counterparta (rozmowa z osobą o
 * nieaktywnym koncie też ma prawo zniknąć ze skrzynki). Jedyny warunek ukrycia:
 * para MA wątek (last_message_at != null) — ukrycie pary bez wiadomości byłoby
 * czarną dziurą (lista „Pokaż ukryte" pokazuje wyłącznie pary z wiadomościami, więc
 * nie dałoby się jej przywrócić); UI nie oferuje ukrycia bez wiadomości, API
 * odpowiada MESSAGING_NOT_ALLOWED. Przywrócenie nie ma tego warunku.
 * updateMany z pełnym WHERE własności strony (IDOR-safe, jeden statement).
 */
export const setConversationHidden_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  hidden: boolean;
}): Promise<
  OperationResult<
    { pair_id: string; hidden_at: Date | null },
    MessagingError | DatabaseError
  >
> => {
  const { currentUser, pairId, hidden } = params;

  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
        last_message_at: true,
        client_hidden_at: true,
        stylist_hidden_at: true,
      },
    });
    if (pair == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    const side = resolvePairSide(pair, currentUser);
    if (side == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    if (hidden && pair.last_message_at == null) {
      return failure({ type: 'MESSAGING_NOT_ALLOWED' as const });
    }

    const isClient = side === StylistClientMessageSenderValue.CLIENT;
    const current = isClient ? pair.client_hidden_at : pair.stylist_hidden_at;
    if (hidden && current != null) {
      return success({ pair_id: pairId, hidden_at: current });
    }
    if (!hidden && current == null) {
      return success({ pair_id: pairId, hidden_at: null });
    }

    const nextValue = hidden ? new Date() : null;
    const stylistAccountId = currentUser.stylist_account?.account_id ?? '';
    await DB_CLIENT.use.clientStylistPair.updateMany({
      where: {
        id: pairId,
        ...(isClient
          ? { client_user_id: currentUser.id }
          : { stylist_account_id: stylistAccountId }),
      },
      data: isClient
        ? { client_hidden_at: nextValue }
        : { stylist_hidden_at: nextValue },
    });

    return success({ pair_id: pairId, hidden_at: nextValue });
  } catch (error) {
    return databaseFailure('setConversationHidden', error);
  }
};
