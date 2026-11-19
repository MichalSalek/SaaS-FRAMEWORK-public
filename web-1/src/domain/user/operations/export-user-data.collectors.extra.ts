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

/**
 * Stylist-authored CRM notes: ClientStylistPair.crm_note and important_note („Ważne przed
 * wizytą”) (+ paired client name). Only pairs that actually carry either note are exported.
 */
export async function collectStylistCrmNotes(
  stylistAccountId: string,
  limit: number
): Promise<UserExportCrmNote[]> {
  const rows = await DB_CLIENT.use.clientStylistPair.findMany({
    where: {
      stylist_account_id: stylistAccountId,
      OR: [{ crm_note: { not: null } }, { important_note: { not: null } }],
    },
    select: {
      crm_note: true,
      crm_note_updated_at: true,
      important_note: true,
      important_note_updated_at: true,
      client_user: { select: { name: true } },
    },
    orderBy: { paired_at: 'desc' },
    take: limit,
  });
  return rows.map(row => ({
    client_name: row.client_user.name,
    crm_note: row.crm_note,
    updated_at: row.crm_note_updated_at?.toISOString() ?? null,
    important_note: row.important_note,
    important_note_updated_at:
      row.important_note_updated_at?.toISOString() ?? null,
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
    // DECISION: the export mirrors the stylist READ gate of getSessionContainerById_IO, not the bare
    // assignment. A container is the client's private draft until she shares it, and one assigned but
    // closed/expired WITHOUT being shared keeps shared_at === null. Exporting on stylist_account_id alone
    // handed the stylist the name and client_note of containers she can never open in the app. Both
    // predicates stay even though shared_at is only set with the SHARED transition, so a future state
    // change cannot reopen the leak.
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
      // DECISION: the PII minimum comes from the SSOT helper (counterpartName), not a second copy of the
      // rule. A plain `name || email` bypassed both of its gates: the client's e-mail is shown only for
      // an ACTIVE pair (a PENDING pair is someone who only asked to connect), and a soft-deleted client
      // reveals neither name nor e-mail. Art. 20 completeness is intact: the user's own messages are
      // still exported, only the other side's label is masked.
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
