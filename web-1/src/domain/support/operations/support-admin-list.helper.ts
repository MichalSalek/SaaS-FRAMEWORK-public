import { DB_CLIENT } from '@app/db/db.client';
import { isValidCursorFormat } from '@kernel/policies/validation/validation.utils';
import type { Prisma } from '../../../prisma/js-client';
import { buildSupportAwaitingReplyPageQuery } from './support-awaiting-reply.predicate';
import {
  assertType,
  isSupportThreadStatusNarrower,
  isSupportSenderTypeNarrower,
} from '@kernel/models/type_narrowing';
import { SUPPORT_CATEGORY_FILTER_NONE } from '@kernel/models/support/support.dto';
import { fetchSupportThreadAggregates } from './support-thread-aggregates.helper';
import type {
  SupportThreadAdminListItem,
  SupportThreadCategory,
  SupportThreadCategoryFilter,
  SupportThreadStatus,
} from '@kernel/models/support/support.dto';

/** Filters of the admin thread list (SUPPORT_ADMIN_GET_ALL_THREADS request). */
export type AdminThreadListFilters = {
  status?: SupportThreadStatus | undefined;
  category?: SupportThreadCategoryFilter | undefined;
  /** true = exactly the threads behind the `support_awaiting_reply` badge. */
  awaitingReply?: boolean | undefined;
};

// `satisfies` sits on a local constant and the export is a separate statement:
// ts-prune (audit dead-exports) reads `export const X = {...} satisfies T` as
// an export named after the type.
const adminThreadRowSelect = {
  id: true,
  subject: true,
  category: true,
  status: true,
  created_at: true,
  updated_at: true,
  user_id: true,
} satisfies Prisma.SupportThreadSelect;

/** Columns of one admin list row; both page selections load exactly these. */
export const ADMIN_THREAD_ROW_SELECT = adminThreadRowSelect;

type AdminThreadRow = Prisma.SupportThreadGetPayload<{
  select: typeof ADMIN_THREAD_ROW_SELECT;
}>;

type AwaitingReplyPage =
  | { invalidCursor: true }
  | {
      invalidCursor: false;
      pageItems: AdminThreadRow[];
      nextCursor: string | null;
    };

/**
 * One page of the "awaiting reply" list.
 *
 * DECISION (nie usuwaj tego komentarza):
 * The page of ids comes from the SAME SQL predicate as the menu badge
 * (support-awaiting-reply.predicate.ts), then the rows are loaded with the
 * list's ordinary select and put back in id order. Filtering an ordinary
 * `status = OPEN` page in Node instead would make pages of uneven length and
 * a total that differs from the badge. The cursor is a keyset (`id < cursor`):
 * only its FORMAT is checked (a malformed one is a 400, as on the other
 * path); it does not have to exist in the set, because a thread leaves the
 * set the moment support answers it. `hasMore` and `nextCursor` are taken
 * from the id page, so a row deleted between the two queries shortens the
 * page without ending the list.
 */
export const fetchAwaitingReplyThreadPage = async (params: {
  cursor: string | undefined;
  category: SupportThreadCategoryFilter | undefined;
  take: number;
}): Promise<AwaitingReplyPage> => {
  const cursor =
    params.cursor === undefined || params.cursor === ''
      ? undefined
      : params.cursor;
  if (cursor !== undefined && !isValidCursorFormat(cursor)) {
    return { invalidCursor: true };
  }

  const idRows = await DB_CLIENT.use.$queryRaw<{ id: string }[]>(
    buildSupportAwaitingReplyPageQuery({
      cursor,
      category: params.category,
      limit: params.take + 1,
    })
  );
  const hasMore = idRows.length > params.take;
  const pageIds = idRows.slice(0, params.take).map(row => row.id);
  if (pageIds.length === 0) {
    return { invalidCursor: false, pageItems: [], nextCursor: null };
  }

  const rows = await DB_CLIENT.use.supportThread.findMany({
    where: { id: { in: pageIds } },
    select: ADMIN_THREAD_ROW_SELECT,
  });
  const rowById = new Map(rows.map(row => [row.id, row] as const));
  const pageItems = pageIds.flatMap(id => {
    const row = rowById.get(id);
    return row === undefined ? [] : [row];
  });

  return {
    invalidCursor: false,
    pageItems,
    nextCursor: hasMore ? (pageIds[pageIds.length - 1] ?? null) : null,
  };
};

/**
 * Admin thread-list row hydration (owner soft-FK resolution + DTO mapping).
 *
 * Split z support-admin.operations.ts dla utrzymania ESLint max-lines (350); mirror
 * konwencji support-admin-error.helper.ts / support-cursor.helper.ts (op-helpery obok
 * operacji). Zachowuje 1:1 zachowanie poprzedniego inline-bloku.
 *
 * DECISION (nie usuwaj tego komentarza): SupportThread.user_id jest soft-FK (FAZA C).
 * User mógł zostać przeniesiony (MOVE po 90d) lub usunięty, więc email/name
 * rozwiązujemy OSOBNYM batch-lookupem (jeden findMany po `id IN (...)`) zamiast joina.
 * Osierocony wątek (brak usera) => pusty fallback ('' — DTO wymaga string). Batch (NIE
 * N+1) zachowuje pojedyncze zapytanie niezależnie od rozmiaru strony.
 */
export const hydrateAdminThreadListItems = async (
  pageItems: ReadonlyArray<{
    id: string;
    subject: string;
    category: SupportThreadCategory | null;
    status: string;
    created_at: Date;
    updated_at: Date;
    user_id: string;
    _count: { messages: number };
    messages: { content: string; sender_type: string }[];
  }>
): Promise<SupportThreadAdminListItem[]> => {
  const ownerIds = [...new Set(pageItems.map(t => t.user_id))];
  const owners =
    ownerIds.length > 0
      ? await DB_CLIENT.use.user.findMany({
          where: { id: { in: ownerIds } },
          select: { id: true, email: true, name: true },
        })
      : [];
  const ownerById = new Map(owners.map(u => [u.id, u]));

  return pageItems.map(t => ({
    id: t.id,
    subject: t.subject,
    category: t.category,
    status: assertType(
      t.status,
      isSupportThreadStatusNarrower,
      'SupportThread.status'
    ),
    created_at: t.created_at,
    updated_at: t.updated_at,
    user_email: ownerById.get(t.user_id)?.email ?? '',
    user_name: ownerById.get(t.user_id)?.name ?? '',
    // DECISION (nie usuwaj tego komentarza): BEZ ponownego przycinania. `content`
    // przychodzi tu już skrócony przez `LEFT(content, SUPPORT_PREVIEW_MAX)` w
    // support-thread-aggregates.helper.ts — to JEDYNE miejsce, które ustala długość
    // podglądu (i robi to w SQL, żeby pełny @db.Text nie szedł po drucie). Wcześniej
    // stała „100" żyła tutaj po raz drugi, zahardkodowana: po zmianie
    // SUPPORT_PREVIEW_MAX na cokolwiek większego ten `slice` po cichu obcinałby
    // podgląd z powrotem do 100 znaków. Jedyny wołający (adminGetAllThreads_IO)
    // podaje wyłącznie wartość z tego agregatu.
    last_message_preview: t.messages[0]?.content ?? null,
    last_message_sender_type:
      t.messages[0] !== undefined
        ? assertType(
            t.messages[0].sender_type,
            isSupportSenderTypeNarrower,
            'SupportMessage.sender_type'
          )
        : null,
    message_count: t._count.messages,
  }));
};

/**
 * Page rows -> admin list items: one aggregate round trip (preview, sender and
 * count of messages), then the owner lookup. Shared by both page selections.
 */
export const toAdminThreadListItems = async (
  pageItems: readonly AdminThreadRow[]
): Promise<SupportThreadAdminListItem[]> => {
  // Owner soft-FK resolution + DTO mapping ekstrahowane do hydrateAdminThreadListItems
  // (support-admin-list.helper.ts) — pełna rationale (soft-FK batch-lookup) w helperze.
  // Helper konsumuje kontrakt "wiersz + ostatnia wiadomość", więc podajemy mu agregat
  // z LATERAL-a w tym samym kształcie: `messages` to co najwyżej JEDNA (najnowsza)
  // wiadomość — dokładnie to, co wcześniej dawał nested take:1, tylko bez streamowania
  // całej historii wątków strony. Brak agregatu (wątek skasowany między zapytaniami) =
  // pusty podgląd i 0 wiadomości, nigdy 500.
  const aggregates = await fetchSupportThreadAggregates(
    pageItems.map(t => t.id)
  );
  return hydrateAdminThreadListItems(
    pageItems.map(t => {
      const aggregate = aggregates.get(t.id);
      const preview = aggregate?.last_message_preview ?? null;
      const senderType = aggregate?.last_message_sender_type ?? null;
      return {
        ...t,
        _count: { messages: aggregate?.message_count ?? 0 },
        messages:
          preview !== null && senderType !== null
            ? [{ content: preview, sender_type: senderType }]
            : [],
      };
    })
  );
};

/** Filters of the ordinary (not "awaiting reply") page as a Prisma `where`. */
export const buildAdminThreadWhere = (
  filters: AdminThreadListFilters
): Prisma.SupportThreadWhereInput => ({
  ...(filters.status ? { status: filters.status } : {}),
  // `NONE` = threads created before categories existed (category IS NULL).
  ...(filters.category === undefined
    ? {}
    : {
        category:
          filters.category === SUPPORT_CATEGORY_FILTER_NONE
            ? null
            : filters.category,
      }),
});
