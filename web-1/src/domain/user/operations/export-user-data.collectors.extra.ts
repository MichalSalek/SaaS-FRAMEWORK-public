import { DB_CLIENT } from '@app/db/db.client';
import {
  SessionContainerLifecycleStateValue,
  SupportSenderTypeValue,
  StylistClientMessageSenderValue,
} from '@kernel/models/db_models.generated.dto';
import { counterpartName } from '@domain/messaging/messaging.helpers';
import type {
  UserExportCrmNote,
  UserExportVisit,
  UserExportSessionContainer,
  UserExportSupportThread,
  UserExportConversation,
} from '@kernel/models/user/user.dto';

// GDPR Art.20 export — extracted collection query-builders (kept out of the main
// collectors file to stay under ESLint max-lines). Each returns an already-mapped,
// "basic" shape (FK -> NAMES, not raw relational graph) and honors COLLECTION_LIMIT
// (passed as `limit` by the caller — avoids a circular import of the constant).
// See DECISION at UserExport* types in .shared-kernel/models/user/user.dto.ts.

/**
 * Stylist-authored CRM notes: ClientStylistPair.crm_note (+ paired client name).
 * Only pairs that actually carry a note are exported.
 */
export async function collectStylistCrmNotes(
  stylistAccountId: string,
  limit: number
): Promise<UserExportCrmNote[]> {
  const rows = await DB_CLIENT.use.clientStylistPair.findMany({
    where: { stylist_account_id: stylistAccountId, crm_note: { not: null } },
    select: {
      crm_note: true,
      crm_note_updated_at: true,
      client_user: { select: { name: true } },
    },
    orderBy: { paired_at: 'desc' },
    take: limit,
  });
  return rows.map(row => ({
    client_name: row.client_user.name,
    crm_note: row.crm_note,
    updated_at: row.crm_note_updated_at?.toISOString() ?? null,
  }));
}

/**
 * Stylist-authored visit records (service note + result photos) with the client
 * resolved to a name. Result photos are reduced to basic fields (url + position).
 */
export async function collectStylistVisits(
  stylistAccountId: string,
  limit: number
): Promise<UserExportVisit[]> {
  const rows = await DB_CLIENT.use.visitRecord.findMany({
    where: { stylist_account_id: stylistAccountId },
    select: {
      visit_date: true,
      service_note: true,
      source: true,
      created_at: true,
      client_user: { select: { name: true } },
      result_photos: {
        select: { asset_url: true, position: true },
        orderBy: { position: 'asc' },
        take: limit,
      },
    },
    orderBy: { visit_date: 'desc' },
    take: limit,
  });
  return rows.map(row => ({
    client_name: row.client_user.name,
    visit_date: row.visit_date.toISOString(),
    service_note: row.service_note,
    source: row.source,
    created_at: row.created_at.toISOString(),
    result_photos: row.result_photos.map(photo => ({
      asset_url: photo.asset_url,
      position: photo.position,
    })),
  }));
}

/**
 * Stylist-side session containers the stylist is allowed to READ, with
 * stylist_note + client_note. Client resolved to a name via the client
 * account's owning user.
 */
export async function collectStylistSessionContainers(
  stylistAccountId: string,
  limit: number
): Promise<UserExportSessionContainer[]> {
  const rows = await DB_CLIENT.use.sessionContainer.findMany({
    // DECISION (nie usuwaj tego komentarza):
    // The export mirrors the stylist READ gate of getSessionContainerById_IO,
    // not the bare assignment. A container is the client's private draft until
    // she shares it: DRAFT/READY is client-private, and a container that was
    // assigned but closed/expired WITHOUT being shared keeps shared_at === null
    // (SCCAP-3). Exporting on stylist_account_id alone handed the stylist the
    // name and client_note of containers she can never open in the app. Both
    // predicates are kept even though shared_at is only ever set together with
    // the SHARED transition, so a future state change cannot reopen the leak.
    where: {
      stylist_account_id: stylistAccountId,
      shared_at: { not: null },
      lifecycle_state: {
        notIn: [
          SessionContainerLifecycleStateValue.DRAFT,
          SessionContainerLifecycleStateValue.READY,
        ],
      },
    },
    select: {
      name: true,
      lifecycle_state: true,
      stylist_note: true,
      client_note: true,
      shared_at: true,
      expires_at: true,
      created_at: true,
      client_account: {
        select: { created_by_user: { select: { name: true } } },
      },
    },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return rows.map(row => ({
    client_name: row.client_account.created_by_user.name,
    name: row.name,
    lifecycle_state: row.lifecycle_state,
    stylist_note: row.stylist_note,
    client_note: row.client_note,
    shared_at: row.shared_at?.toISOString() ?? null,
    expires_at: row.expires_at?.toISOString() ?? null,
    created_at: row.created_at.toISOString(),
  }));
}

/**
 * User-authored support conversations: SupportThread (subject/status) + the
 * messages the user themselves wrote (sender_type = USER). Account-agnostic
 * (keyed by SupportThread.user_id) — assembled at the operation's top level.
 */
export async function collectSupportThreads(
  userId: string,
  limit: number
): Promise<UserExportSupportThread[]> {
  const rows = await DB_CLIENT.use.supportThread.findMany({
    where: { user_id: userId },
    select: {
      subject: true,
      status: true,
      created_at: true,
      updated_at: true,
      messages: {
        where: { sender_type: SupportSenderTypeValue.USER },
        select: { content: true, created_at: true },
        orderBy: { created_at: 'asc' },
        take: limit,
      },
    },
    orderBy: { created_at: 'desc' },
    take: limit,
  });
  return rows.map(thread => ({
    subject: thread.subject,
    status: thread.status,
    created_at: thread.created_at.toISOString(),
    updated_at: thread.updated_at.toISOString(),
    messages: thread.messages.map(message => ({
      content: message.content,
      created_at: message.created_at.toISOString(),
    })),
  }));
}

/**
 * GDPR Art.20 — wiadomości komunikatora stylistka<->klientka AUTORSTWA usera.
 * Parytet z collectSupportThreads (tam sender_type=USER): eksportujemy TYLKO
 * stronę usera konwersacji (jego wiadomości), nie drugiej osoby (to jej dane).
 * User bywa dual-role → obie strony par: jako klientka (client_user_id=userId,
 * sender_type=CLIENT) I jako stylistka (stylist_account.created_by_user_id=
 * userId, sender_type=STYLIST). Basic-shape: counterpart FK->nazwa, bez ID.
 */
export async function collectPairMessages(
  userId: string,
  limit: number
): Promise<UserExportConversation[]> {
  const pairs = await DB_CLIENT.use.clientStylistPair.findMany({
    where: {
      OR: [
        { client_user_id: userId },
        { stylist_account: { created_by_user_id: userId } },
      ],
    },
    select: {
      status: true,
      client_user_id: true,
      client_user: { select: { name: true, email: true, is_active: true } },
      stylist_account: {
        select: { display_name: true, business_name: true },
      },
      messages: {
        select: { content: true, created_at: true, sender_type: true },
        orderBy: { created_at: 'asc' },
        take: limit,
      },
    },
    orderBy: { paired_at: 'desc' },
    take: limit,
  });
  return pairs
    .map(pair => {
      const userIsClient = pair.client_user_id === userId;
      // Strona usera → jego wiadomości; counterpart = druga strona (nazwa).
      const mySide = userIsClient
        ? StylistClientMessageSenderValue.CLIENT
        : StylistClientMessageSenderValue.STYLIST;
      // PII-minimum liczy SSOT-helper, nie druga kopia reguły tutaj. Ręczne
      // `name || email` omijało OBIE bramki, które helper trzyma z jawnym DECISION:
      // e-mail klientki wolno pokazać dopiero przy parze ACTIVE (para PENDING to
      // ktoś, kto tylko poprosił o połączenie i nigdy nie został zaakceptowany —
      // `getPendingPairRequests` celowo oddaje samo imię), a klientka po
      // soft-delete nie ujawnia ani imienia, ani e-maila. Eksport oddawał jedno
      // i drugie, czyli dane, których stylistce nie odda ŻADNA żywa powierzchnia.
      // Kompletność Art. 20 jest nienaruszona: własne wiadomości usera lecą dalej,
      // maskowana jest wyłącznie etykieta drugiej strony.
      const resolvedCounterpartName = counterpartName(mySide, {
        clientName: pair.client_user?.name ?? null,
        clientEmail: pair.client_user?.email ?? null,
        pairStatus: pair.status,
        clientIsActive: pair.client_user?.is_active ?? false,
        stylistDisplayName: pair.stylist_account?.display_name ?? null,
        stylistBusinessName: pair.stylist_account?.business_name ?? null,
      });
      return {
        counterpart_name: resolvedCounterpartName,
        pair_status: pair.status,
        messages: pair.messages
          .filter(m => m.sender_type === mySide)
          .map(m => ({
            content: m.content,
            created_at: m.created_at.toISOString(),
          })),
      };
    })
    .filter(conv => conv.messages.length > 0);
}
