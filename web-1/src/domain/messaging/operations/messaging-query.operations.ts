/**
 * Messaging read operations — getThread_IO, getConversations_IO.
 *
 * Oba party-gated (resolvePairSide). Wątek: cursor-paginacja (created_at,id)
 * scoped do pary (bez existence-oracle — cursor sprawdzany WHERE id+pair_id).
 * Lista rozmów: unia stron (client + stylist) filtrowana last_message_at cursorem,
 * unread liczony per para (druga strona, created_at > mój last_read_at).
 */

import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { success, failure } from '@kernel/application/result.types';
import type { OperationResult } from '@kernel/application/result.types';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { MessagingError } from '@kernel/domain/messaging/messaging-errors.types';
import {
  StylistClientMessageSenderValue,
  type MessagingMessageDTO,
  type MessagingThreadMeta,
  type MessagingConversationDTO,
} from '@kernel/models/messaging/messaging.dto';
import { AccountStatusValue } from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import {
  resolvePairSide,
  canSendToPair,
  counterpartName,
} from '../messaging.helpers';
import { Prisma } from '../../../prisma/js-client';
import { parsePgSafeDate } from '@kernel/policies/validation/validation.utils';

const THREAD_PAGE = 50;
const CONVERSATIONS_PAGE = 50;
const PREVIEW_MAX = 120;

/**
 * Podgląd ostatniej wiadomości na liście rozmów.
 *
 * `slice` tnie po jednostkach UTF-16, więc emoji spoza podstawowej płaszczyzny
 * (a takich w czacie jest sporo) rozpadało się na granicy podglądu: w inboxie
 * zostawał osierocony surogat, który przeglądarka rysuje jako „�". Cięcie po
 * PUNKTACH KODOWYCH nie rozrywa pary surogatów. Sekwencje złożone (emoji z
 * modyfikatorem koloru skóry, ZWJ) wciąż mogą się rozpaść na granicy — to
 * świadomie poza zakresem tej poprawki, bo wymaga segmentacji grafemowej,
 * a chodzi o odcięcie widocznego artefaktu, nie o typografię.
 */
const previewOf = (content: string): string =>
  [...content].slice(0, PREVIEW_MAX).join('');

type ConversationAggregateRow = {
  pair_id: string;
  last_message_content: string | null;
  unread_count: number;
};

export const getThread_IO = async (params: {
  currentUser: CurrentUser;
  pairId: string;
  cursor?: string;
}): Promise<
  OperationResult<
    {
      meta: MessagingThreadMeta;
      messages: MessagingMessageDTO[];
      next_cursor: string | null;
    },
    MessagingError | DatabaseError
  >
> => {
  const { currentUser, pairId, cursor } = params;

  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findUnique({
      where: { id: pairId },
      select: {
        id: true,
        client_user_id: true,
        stylist_account_id: true,
        status: true,
        stylist_hidden_at: true,
        client_hidden_at: true,
        client_user: { select: { name: true, email: true, is_active: true } },
        stylist_account: {
          select: {
            display_name: true,
            business_name: true,
            avatar_url: true,
            created_by_user: { select: { image: true } },
            account_status: true,
          },
        },
      },
    });
    if (pair == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }
    const side = resolvePairSide(pair, currentUser);
    if (side == null) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }

    // DECISION (nie usuwaj tego komentarza):
    // Live-surface counterpart-visibility mask (SSOT: pairing-query.operations.ts
    // getMyPairs_IO — client_user.is_active dla listy stylistki, stylist_account.
    // account_status=ACTIVE dla listy klientki). Messaging to POWIERZCHNIA ŻYWEJ
    // RELACJI, więc MUSI lustrzać kaskadę: soft-deleted/disabled counterpart (para
    // zostaje ACTIVE per Model A, DOMAIN_SSOT §13.1) jest MASKOWANY na żywych
    // powierzchniach; tylko CRM/archiwum retencjonuje. Werdykt = ten sam co
    // nie-strona (MESSAGING_PAIR_NOT_FOUND, anti-enumeration parity) — bez tego
    // ghost-pair renderował biznesową tożsamość + avatar zdjętej stylistki (albo
    // imię zdjętej klientki), a getThread pokazywał martwy wątek. Odwracalne po
    // re-enable counterparta.
    const counterpartInactive =
      side === StylistClientMessageSenderValue.CLIENT
        ? pair.stylist_account?.account_status !== AccountStatusValue.ACTIVE
        : pair.client_user?.is_active === false;
    if (counterpartInactive) {
      return failure({ type: 'MESSAGING_PAIR_NOT_FOUND' as const });
    }

    // Cursor scoped do pary (id MUSI należeć do tej pary — zamyka existence-oracle).
    let olderThan: { created_at: Date; id: string } | null = null;
    if (cursor != null && cursor.length > 0) {
      const anchor = await DB_CLIENT.use.stylistClientMessage.findFirst({
        where: { id: cursor, pair_id: pairId },
        select: { created_at: true, id: true },
      });
      if (anchor != null) {
        olderThan = anchor;
      }
    }

    const rows = await DB_CLIENT.use.stylistClientMessage.findMany({
      where: {
        pair_id: pairId,
        ...(olderThan != null
          ? {
              OR: [
                { created_at: { lt: olderThan.created_at } },
                {
                  created_at: olderThan.created_at,
                  id: { lt: olderThan.id },
                },
              ],
            }
          : {}),
      },
      orderBy: [{ created_at: 'desc' }, { id: 'desc' }],
      take: THREAD_PAGE + 1,
      select: {
        id: true,
        sender_type: true,
        content: true,
        created_at: true,
      },
    });

    const hasMore = rows.length > THREAD_PAGE;
    const page = hasMore ? rows.slice(0, THREAD_PAGE) : rows;
    const next_cursor = hasMore ? (page[page.length - 1]?.id ?? null) : null;
    // Do wyświetlenia: najstarsze→najnowsze (odwracamy DESC-page).
    const messages = [...page].reverse();

    const meta: MessagingThreadMeta = {
      pair_id: pair.id,
      status: pair.status,
      counterpart_name: counterpartName(side, {
        clientName: pair.client_user?.name ?? null,
        clientEmail: pair.client_user?.email ?? null,
        pairStatus: pair.status,
        clientIsActive: pair.client_user?.is_active ?? false,
        stylistDisplayName: pair.stylist_account?.display_name ?? null,
        stylistBusinessName: pair.stylist_account?.business_name ?? null,
      }),
      // Pełny łańcuch zdjęcia (własny upload → obraz z OAuth → inicjały w
      // interfejsie). Wątek czytał samą kolumnę, która do 2026-09-09 nie miała
      // ścieżki zapisu, więc rozmowa ze stylistką zawsze pokazywała inicjały.
      counterpart_avatar_url:
        side === StylistClientMessageSenderValue.CLIENT
          ? (pair.stylist_account?.avatar_url ??
            pair.stylist_account?.created_by_user?.image ??
            null)
          : null,
      viewer_side: side,
      can_send: canSendToPair(pair.status),
      // D2: znacznik ukrycia PO STRONIE WOŁAJĄCEGO. Ukryty wątek jest nadal
      // otwieralny (z „Pokaż ukryte" i z deep-linku) — to własne dane wołającego;
      // widok pokazuje „Przywróć" zamiast „Ukryj".
      hidden_at:
        side === StylistClientMessageSenderValue.CLIENT
          ? pair.client_hidden_at
          : pair.stylist_hidden_at,
    };

    return success({ meta, messages, next_cursor });
  } catch (error) {
    return databaseFailure('getThread', error);
  }
};

export const getConversations_IO = async (params: {
  currentUser: CurrentUser;
  cursor?: string;
  /** D2: true = WYŁĄCZNIE rozmowy ukryte przez wołającego („Pokaż ukryte"). */
  hidden?: boolean;
}): Promise<
  OperationResult<
    { conversations: MessagingConversationDTO[]; next_cursor: string | null },
    DatabaseError
  >
> => {
  const { currentUser, cursor } = params;
  const stylistAccountId = currentUser.stylist_account?.account_id ?? null;
  // DECISION (nie usuwaj tego komentarza) — D2 (2026-09-05), HIDE = MUTE:
  // filtr ukrycia siedzi w OBU gałęziach findMany (strona klientki patrzy na
  // client_hidden_at, strona stylistki na stylist_hidden_at), więc ukryty wątek
  // wypada z listy domyślnej, z podsumowania nieprzeczytanych (badge liczy tę
  // listę) i z paginacji keyset. Nowa wiadomość bumpuje last_message_at, ale NIE
  // zeruje znacznika — wątek pozostaje ukryty do jawnego „Przywróć". Lista
  // `hidden=true` odwraca predykat (IS NOT NULL) i jest źródłem „Przywróć".
  const hiddenOnly = params.hidden === true;
  const clientHiddenWhere = hiddenOnly
    ? { client_hidden_at: { not: null } }
    : { client_hidden_at: null };
  const stylistHiddenWhere = hiddenOnly
    ? { stylist_hidden_at: { not: null } }
    : { stylist_hidden_at: null };

  try {
    // Composite keyset cursor "isoDate|pairId": tiebreaker po pair.id domyka
    // data-loss (dwie pary z tym samym last_message_at ms gubiłyby jedną na
    // granicy strony przy samym `lt` na dacie — closing-review MEDIUM).
    let cursorDate: Date | null = null;
    let cursorPairId = '';
    if (cursor != null && cursor.length > 0) {
      const sep = cursor.lastIndexOf('|');
      const isoPart = sep >= 0 ? cursor.slice(0, sep) : cursor;
      cursorPairId = sep >= 0 ? cursor.slice(sep + 1) : '';
      // Kursor poza zakresem PostgreSQL traktujemy jak nieparsowalny (pierwsza
      // strona), a nie jak awarię: wcześniej taka wartość docierała do Prismy
      // i wracała jako 500, więc zwykły zalogowany user jednym parametrem w URL-u
      // produkował dowolnie długą serię błędów w error-storze i alertach.
      const parsed = parsePgSafeDate(isoPart);
      if (parsed !== null) {
        cursorDate = parsed;
      }
    }

    // Keyset WHERE (kolejność last_message_at DESC, id DESC): starsze od kursora
    // = (lmt < cursor) LUB (lmt = cursor AND id < cursorId). Warunki na
    // last_message_at wykluczają null (Prisma null-semantyka lt) — dla braku
    // kursora dajemy explicit { not: null }.
    const cursorWhere =
      cursorDate != null
        ? {
            OR: [
              { last_message_at: { lt: cursorDate } },
              { last_message_at: cursorDate, id: { lt: cursorPairId } },
            ],
          }
        : { last_message_at: { not: null } };

    const selectPair = {
      id: true,
      status: true,
      last_message_at: true,
      client_last_read_at: true,
      stylist_last_read_at: true,
      client_hidden_at: true,
      stylist_hidden_at: true,
      client_user_id: true,
      stylist_account_id: true,
      client_user: { select: { name: true, email: true, is_active: true } },
      stylist_account: {
        select: {
          display_name: true,
          business_name: true,
          avatar_url: true,
          created_by_user: { select: { image: true } },
        },
      },
    } as const;

    // Obie strony RÓWNOLEGLE (S82: niezależne findMany na tych samych
    // parametrach kursora — sekwencyjny await podwajał latencję pollowanego
    // inboxu dla dual-role usera).
    // DECISION (nie usuwaj tego komentarza):
    // Live-surface counterpart-visibility mask, mirror pairing-query.operations.ts
    // getMyPairs_IO 1:1 (client-viewing-stylists → stylist_account.account_status=
    // ACTIVE; stylist-viewing-clients → client_user.is_active=true). Messaging =
    // powierzchnia żywej relacji: soft-deleted/disabled counterpart (para zostaje
    // ACTIVE per Model A) NIE pojawia się w inboxie — live-surface-masks, archive-
    // retains. Bez tego ghost-pair z PII zdjętego counterparta (biznesowa nazwa +
    // avatar / imię klientki) renderowałby się z can_send=true (write-into-void).
    const [clientPairs, stylistPairs] = await Promise.all([
      // Strona KLIENTA: pary gdzie caller = client_user (counterpart = stylistka).
      DB_CLIENT.use.clientStylistPair.findMany({
        where: {
          client_user_id: currentUser.id,
          stylist_account: { account_status: AccountStatusValue.ACTIVE },
          ...clientHiddenWhere,
          ...cursorWhere,
        },
        orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
        take: CONVERSATIONS_PAGE + 1,
        select: selectPair,
      }),
      // Strona STYLISTKI: pary gdzie caller = właściciel stylist_account
      // (counterpart = klientka; klienci nie mają account_status — is_active to
      // ich jedyny flag widoczności, patrz getMyPairs_IO branch stylisty).
      stylistAccountId != null
        ? DB_CLIENT.use.clientStylistPair.findMany({
            where: {
              stylist_account_id: stylistAccountId,
              client_user: { is_active: true },
              ...stylistHiddenWhere,
              ...cursorWhere,
            },
            orderBy: [{ last_message_at: 'desc' }, { id: 'desc' }],
            take: CONVERSATIONS_PAGE + 1,
            select: selectPair,
          })
        : Promise.resolve([]),
    ]);

    // Scal + posortuj (last_message_at DESC, id DESC — ten sam total-order co
    // keyset, żeby paginacja była spójna) + utnij do strony.
    const merged = [...clientPairs, ...stylistPairs].sort((a, b) => {
      const ta = a.last_message_at?.getTime() ?? 0;
      const tb = b.last_message_at?.getTime() ?? 0;
      if (tb !== ta) {
        return tb - ta;
      }
      return a.id < b.id ? 1 : a.id > b.id ? -1 : 0;
    });
    const hasMore = merged.length > CONVERSATIONS_PAGE;
    const pagePairs = hasMore ? merged.slice(0, CONVERSATIONS_PAGE) : merged;
    const lastPair = pagePairs[pagePairs.length - 1];
    const next_cursor =
      hasMore && lastPair?.last_message_at != null
        ? `${lastPair.last_message_at.toISOString()}|${lastPair.id}`
        : null;

    // Unread + preview dla całej strony w JEDNYM round-tripie.
    // DECISION (nie usuwaj tego komentarza):
    // Prisma 7 `distinct: ['pair_id']` z adapter-pg nadal deduplikuje w Node i
    // streamuje historię, dlatego tu jawny parametryzowany LATERAL. `pairIds` i
    // currentUser.id pochodzą z serwera i są bind-parametrami Prisma.sql/Prisma.join
    // (zero interpolacji tekstowej). LATERAL zachowuje LIMIT 1 per indeks, a agregat
    // unread zwraca dokładnie jeden wiersz na parę. Max: 1 raw query dla 50 par
    // zamiast 2N ORM queries przy każdym 30-sekundowym pollu.
    const pairIds = pagePairs.map(pair => pair.id);
    const aggregateRows =
      pairIds.length === 0
        ? []
        : await DB_CLIENT.use.$queryRaw<ConversationAggregateRow[]>(Prisma.sql`
            SELECT
              p."id" AS pair_id,
              latest."content" AS last_message_content,
              unread."unread_count" AS unread_count
            FROM "ClientStylistPair" p
            LEFT JOIN LATERAL (
              SELECT m."content"
              FROM "StylistClientMessage" m
              WHERE m."pair_id" = p."id"
              ORDER BY m."created_at" DESC, m."id" DESC
              LIMIT 1
            ) latest ON true
            CROSS JOIN LATERAL (
              SELECT COUNT(*)::int AS unread_count
              FROM "StylistClientMessage" m
              WHERE m."pair_id" = p."id"
                AND m."sender_type" = CASE
                  WHEN p."client_user_id" = ${currentUser.id}
                    THEN ${StylistClientMessageSenderValue.STYLIST}::"StylistClientMessageSender"
                  ELSE ${StylistClientMessageSenderValue.CLIENT}::"StylistClientMessageSender"
                END
                AND m."created_at" > COALESCE(
                  CASE
                    WHEN p."client_user_id" = ${currentUser.id}
                      THEN p."client_last_read_at"
                    ELSE p."stylist_last_read_at"
                  END,
                  '-infinity'::timestamp
                )
            ) unread
            WHERE p."id" IN (${Prisma.join(pairIds)})
          `);
    const aggregatesByPairId = new Map(
      aggregateRows.map(row => [row.pair_id, row] as const)
    );

    const conversations: MessagingConversationDTO[] = pagePairs.map(pair => {
      const side =
        pair.client_user_id === currentUser.id
          ? StylistClientMessageSenderValue.CLIENT
          : StylistClientMessageSenderValue.STYLIST;
      const isClient = side === StylistClientMessageSenderValue.CLIENT;
      const aggregate = aggregatesByPairId.get(pair.id);
      const lastMessageContent = aggregate?.last_message_content ?? null;

      return {
        pair_id: pair.id,
        status: pair.status,
        counterpart_name: counterpartName(side, {
          clientName: pair.client_user?.name ?? null,
          clientEmail: pair.client_user?.email ?? null,
          pairStatus: pair.status,
          clientIsActive: pair.client_user?.is_active ?? false,
          stylistDisplayName: pair.stylist_account?.display_name ?? null,
          stylistBusinessName: pair.stylist_account?.business_name ?? null,
        }),
        counterpart_avatar_url: isClient
          ? (pair.stylist_account?.avatar_url ??
            pair.stylist_account?.created_by_user?.image ??
            null)
          : null,
        last_message_preview:
          lastMessageContent != null ? previewOf(lastMessageContent) : null,
        last_message_at: pair.last_message_at,
        // Concurrent pair delete between the page query and aggregate query is
        // represented as an empty aggregate, never a 500 / missing conversation.
        unread_count: aggregate?.unread_count ?? 0,
        can_send: canSendToPair(pair.status),
        hidden_at: isClient ? pair.client_hidden_at : pair.stylist_hidden_at,
      };
    });

    return success({ conversations, next_cursor });
  } catch (error) {
    return databaseFailure('getConversations', error);
  }
};
