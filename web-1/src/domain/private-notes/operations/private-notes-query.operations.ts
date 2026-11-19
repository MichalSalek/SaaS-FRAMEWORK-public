// The stylist's private notes hub: every note she can read, newest first, capped by
// PRIVATE_NOTES_CONFIG.LIST_MAX (important, client card, session, visit) plus the client filter.
//
// DECISION: read rules match the screen each row opens, so the hub never shows a note that
// screen would refuse (active pair, plan gate, visit retention, shared sessions only).
// Change one side and change the other. stylist_account_id comes from the session; a foreign
// client id only narrows her rows and returns empty lists.

import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { sessionStylistRelationshipWhere } from '@domain/session-container/session-activity.access';
import { createCurrentPairFilter } from './private-notes-pair-access';
import {
  getHistoryAccess,
  retentionCutoff,
} from '@domain/visit/operations/visit-common.operations';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import { PRIVATE_NOTES_CONFIG } from '@kernel/domain/private-notes/private-notes.config';
import {
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import type {
  ClientCardNoteDTO,
  ClientImportantNoteDTO,
  PRIVATE_NOTES_DTO_API_V1,
  PrivateNoteClientDTO,
  SessionNoteDTO,
  VisitNoteDTO,
} from '@kernel/models/private-notes/private-notes.dto';
import type { Prisma } from '../../../prisma/js-client';

type Response =
  PRIVATE_NOTES_DTO_API_V1['ACCOUNT_GET_PRIVATE_NOTES']['RESPONSE'];

const LIST_TAKE = PRIVATE_NOTES_CONFIG.LIST_MAX + 1;

/** A stored note worth showing: present and not only whitespace. */
const readableNote = (note: string | null | undefined): string | null => {
  const trimmed = note?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

const toClient = (user: {
  id: string;
  name: string | null;
}): PrivateNoteClientDTO => {
  const name = user.name?.trim() ?? '';
  return { client_user_id: user.id, name: name.length > 0 ? name : null };
};

/** Sessions of this stylist that she may read (mirror of getSessionContainerById_IO). */
export const readableSessionWhere = (
  stylist_account_id: string
): Prisma.SessionContainerWhereInput => ({
  stylist_account_id,
  shared_at: { not: null },
  lifecycle_state: {
    notIn: [
      SessionContainerLifecycleStateValue.DRAFT,
      SessionContainerLifecycleStateValue.READY,
    ],
  },
  client_account: { created_by_user: { is_active: true } },
  AND: [sessionStylistRelationshipWhere(stylist_account_id)],
  OR: [{ stylist_note: { not: null } }, { client_note: { not: null } }],
});

const capped = <T>(rows: T[]): { rows: T[]; truncated: boolean } =>
  rows.length > PRIVATE_NOTES_CONFIG.LIST_MAX
    ? { rows: rows.slice(0, PRIVATE_NOTES_CONFIG.LIST_MAX), truncated: true }
    : { rows, truncated: false };

export const getPrivateNotes_IO = async ({
  stylist_account_id,
  stylist_pricing_plan,
  client_user_id,
}: {
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  client_user_id?: string | undefined;
}): Promise<OperationResult<Response, DatabaseError | ValidationError>> => {
  if (
    client_user_id !== undefined &&
    (client_user_id.length === 0 ||
      client_user_id.length > PRIVATE_NOTES_CONFIG.CLIENT_ID_MAX)
  ) {
    return failure({
      type: 'VALIDATION_ERROR',
      field: 'client_user_id',
      message: 'Invalid client_user_id',
    });
  }

  const historyAccess = getHistoryAccess(stylist_pricing_plan);
  const historyLocked = !historyAccess.canViewHistory;
  const clientFilter = client_user_id;

  try {
    const filterCurrentPairs = createCurrentPairFilter(stylist_account_id);
    // Session notes: no plan gate (the session screen has none either).
    const sessionWhere = readableSessionWhere(stylist_account_id);
    const sessionSelect = {
      id: true,
      name: true,
      stylist_note: true,
      client_note: true,
      updated_at: true,
      client_account: {
        select: { created_by_user: { select: { id: true, name: true } } },
      },
    } as const;

    // „Ważne przed wizytą”: the client card's pair rule (ACTIVE pair, active client) without
    // the plan gate, see the DECISION in client-important-note.operations.ts.
    const importantWhere: Prisma.ClientStylistPairWhereInput = {
      stylist_account_id,
      status: PairingStatusValue.ACTIVE,
      client_user: { is_active: true },
      important_note: { not: null },
    };

    const [sessionRows, sessionClientRows, importantRows] = await Promise.all([
      DB_CLIENT.use.sessionContainer.findMany({
        where: clientFilter
          ? {
              ...sessionWhere,
              client_account: {
                created_by_user_id: clientFilter,
                created_by_user: { is_active: true },
              },
            }
          : sessionWhere,
        select: sessionSelect,
        orderBy: [{ updated_at: 'desc' }, { id: 'desc' }],
        take: LIST_TAKE,
      }),
      DB_CLIENT.use.sessionContainer.findMany({
        where: sessionWhere,
        select: {
          client_account: {
            select: { created_by_user: { select: { id: true, name: true } } },
          },
        },
        distinct: ['client_account_id'],
        take: PRIVATE_NOTES_CONFIG.CLIENTS_MAX,
      }),
      DB_CLIENT.use.clientStylistPair.findMany({
        where: importantWhere,
        select: {
          salon_origin_account_id: true,
          important_note: true,
          important_note_updated_at: true,
          client_user: { select: { id: true, name: true } },
        },
        orderBy: [{ important_note_updated_at: 'desc' }, { id: 'desc' }],
        take: PRIVATE_NOTES_CONFIG.PAIRS_MAX,
      }),
    ]);

    const sessionNotes: SessionNoteDTO[] = [];
    for (const row of sessionRows) {
      const client = toClient(row.client_account.created_by_user);
      const base = {
        session_id: row.id,
        session_name: readableNote(row.name),
        client,
        updated_at: row.updated_at.toISOString(),
      };
      const stylistNote = readableNote(row.stylist_note);
      const clientNote = readableNote(row.client_note);
      if (stylistNote) {
        sessionNotes.push({ ...base, author: 'STYLIST', note: stylistNote });
      }
      if (clientNote) {
        sessionNotes.push({ ...base, author: 'CLIENT', note: clientNote });
      }
    }
    // One session can carry two notes, so the cap applies to NOTES, and the
    // session query's own extra row also says „there is more”.
    const sessionCap = capped(sessionNotes);
    const clients = new Map<string, PrivateNoteClientDTO>();
    for (const row of sessionClientRows) {
      const client = toClient(row.client_account.created_by_user);
      clients.set(client.client_user_id, client);
    }

    const currentImportantRows = await filterCurrentPairs(
      importantRows,
      row => row.client_user.id
    );
    const importantNotes: ClientImportantNoteDTO[] =
      currentImportantRows.flatMap(row => {
        const note = readableNote(row.important_note);
        return note
          ? [
              {
                client: toClient(row.client_user),
                note,
                updated_at: (
                  row.important_note_updated_at ?? new Date(0)
                ).toISOString(),
              },
            ]
          : [];
      });
    for (const item of importantNotes) {
      clients.set(item.client.client_user_id, item.client);
    }
    const importantCap = capped(
      clientFilter
        ? importantNotes.filter(
            item => item.client.client_user_id === clientFilter
          )
        : importantNotes
    );

    let clientNotes: ClientCardNoteDTO[] = [];
    let clientNotesTruncated = false;
    let visitNotes: VisitNoteDTO[] = [];
    let visitNotesTruncated = false;

    if (!historyLocked) {
      // Active pairs with an active client: the client card's own rule.
      const pairs = await DB_CLIENT.use.clientStylistPair.findMany({
        where: {
          stylist_account_id,
          status: PairingStatusValue.ACTIVE,
          client_user: { is_active: true },
        },
        select: {
          client_user_id: true,
          salon_origin_account_id: true,
          crm_note: true,
          crm_note_updated_at: true,
          client_user: { select: { id: true, name: true } },
        },
        orderBy: [{ paired_at: 'desc' }],
        take: PRIVATE_NOTES_CONFIG.PAIRS_MAX,
      });
      const currentPairs = await filterCurrentPairs(
        pairs,
        pair => pair.client_user_id
      );
      const activeClientIds = currentPairs.map(pair => pair.client_user_id);
      const cutoff = retentionCutoff(historyAccess.retentionDays);
      const visitWhere: Prisma.VisitRecordWhereInput = {
        stylist_account_id,
        client_user_id: { in: activeClientIds },
        service_note: { not: null },
        ...(cutoff && { visit_date: { gte: cutoff } }),
      };

      const [visitRows, visitClientRows] =
        activeClientIds.length === 0
          ? [[], []]
          : await Promise.all([
              DB_CLIENT.use.visitRecord.findMany({
                where: clientFilter
                  ? {
                      ...visitWhere,
                      client_user_id: activeClientIds.includes(clientFilter)
                        ? clientFilter
                        : { in: [] },
                    }
                  : visitWhere,
                select: {
                  id: true,
                  service_note: true,
                  visit_date: true,
                  client_user: { select: { id: true, name: true } },
                },
                orderBy: [{ visit_date: 'desc' }, { id: 'desc' }],
                take: LIST_TAKE,
              }),
              DB_CLIENT.use.visitRecord.findMany({
                where: visitWhere,
                select: { client_user: { select: { id: true, name: true } } },
                distinct: ['client_user_id'],
                take: PRIVATE_NOTES_CONFIG.CLIENTS_MAX,
              }),
            ]);

      const notedPairs = currentPairs
        .flatMap(pair => {
          const note = readableNote(pair.crm_note);
          return note
            ? [
                {
                  client: toClient(pair.client_user),
                  note,
                  updated_at: (
                    pair.crm_note_updated_at ?? new Date(0)
                  ).toISOString(),
                },
              ]
            : [];
        })
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at));
      for (const pair of notedPairs) {
        clients.set(pair.client.client_user_id, pair.client);
      }
      const clientCap = capped(
        clientFilter
          ? notedPairs.filter(
              pair => pair.client.client_user_id === clientFilter
            )
          : notedPairs
      );
      clientNotes = clientCap.rows;
      clientNotesTruncated = clientCap.truncated;

      for (const row of visitClientRows) {
        const client = toClient(row.client_user);
        clients.set(client.client_user_id, client);
      }
      const visitCap = capped(
        visitRows.flatMap(row => {
          const note = readableNote(row.service_note);
          return note
            ? [
                {
                  visit_id: row.id,
                  client: toClient(row.client_user),
                  note,
                  visit_date: row.visit_date.toISOString(),
                },
              ]
            : [];
        })
      );
      visitNotes = visitCap.rows;
      visitNotesTruncated =
        visitCap.truncated || visitRows.length === LIST_TAKE;
    }

    return success({
      history_locked: historyLocked,
      important_notes: importantCap.rows,
      important_notes_truncated: importantCap.truncated,
      clients: [...clients.values()]
        .sort((a, b) =>
          (a.name ?? '').localeCompare(b.name ?? '', 'pl', {
            sensitivity: 'base',
          })
        )
        .slice(0, PRIVATE_NOTES_CONFIG.CLIENTS_MAX),
      client_notes: clientNotes,
      client_notes_truncated: clientNotesTruncated,
      session_notes: sessionCap.rows,
      session_notes_truncated:
        sessionCap.truncated || sessionRows.length === LIST_TAKE,
      visit_notes: visitNotes,
      visit_notes_truncated: visitNotesTruncated,
    });
  } catch (error) {
    return databaseFailure('getPrivateNotes_IO', error);
  }
};
