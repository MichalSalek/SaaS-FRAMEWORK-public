// client-important-note.operations.ts
// „Ważne przed wizytą” (owner): the stylist's ONE short safety note about a client
// (an allergy, a sensitivity), on ClientStylistPair.important_note.
//
// DECISION: no plan gate, unlike the CRM note (getClientCrmNote_IO): safety information must be
// there on every plan, Free included, or a downgrade would hide an allergy from the stylist who
// wrote it down. Ownership rules are the CRM note's: stylist_account_id comes from the session, a
// non-empty write and every read need an ACTIVE pair with an active client, and an empty write
// clears the field in ANY pair state (her own data; parity with deleteClientCrmNote_IO), answering
// with the state after the operation so no pair existence leaks. Never part of a client-facing DTO.

import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type {
  DatabaseError,
  ValidationError,
} from '@kernel/application/common-errors.types';
import { lockConversation } from '@app/db/lock-rows';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ClientUnauthorizedAccessError } from '@kernel/domain/client/client-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import type { ClientImportantNoteDTO } from '@kernel/models/visit/visit.dto';
import { clientPairAccessIsCurrent } from '@domain/pairing/pair-access-current';

type ClientImportantNoteError =
  ClientUnauthorizedAccessError | DatabaseError | ValidationError;

export const normalizeImportantNote = (note: string): string | null => {
  const flat = note.replace(/\s+/g, ' ').trim();
  return flat.length > 0 ? flat : null;
};

const activePairWhere = (
  client_user_id: string,
  stylist_account_id: string
) => ({
  client_user_id,
  stylist_account_id,
  status: PairingStatusValue.ACTIVE,
  client_user: { is_active: true },
});

const notPaired = (
  client_user_id: string,
  stylist_account_id: string
): OperationResult<never, ClientUnauthorizedAccessError> =>
  failure({
    type: 'CLIENT_UNAUTHORIZED_ACCESS',
    clientId: client_user_id,
    stylistAccountId: stylist_account_id,
  });

export const getClientImportantNote_IO = async ({
  stylist_account_id,
  client_user_id,
}: {
  stylist_account_id: string;
  client_user_id: string;
}): Promise<
  OperationResult<ClientImportantNoteDTO, ClientImportantNoteError>
> => {
  try {
    const pair = await DB_CLIENT.use.clientStylistPair.findFirst({
      where: activePairWhere(client_user_id, stylist_account_id),
      select: {
        important_note: true,
        important_note_updated_at: true,
        salon_origin_account_id: true,
      },
    });
    if (
      !pair ||
      !(await clientPairAccessIsCurrent(
        pair,
        client_user_id,
        stylist_account_id
      ))
    ) {
      return notPaired(client_user_id, stylist_account_id);
    }
    return success({
      note: pair.important_note,
      updatedAt: pair.important_note_updated_at?.toISOString() ?? null,
    });
  } catch (error) {
    return databaseFailure('getClientImportantNote_IO', error);
  }
};

export const upsertClientImportantNote_IO = async ({
  stylist_account_id,
  client_user_id,
  note,
  expected_updated_at,
}: {
  stylist_account_id: string;
  client_user_id: string;
  note: string;
  expected_updated_at?: string | null;
}): Promise<
  OperationResult<ClientImportantNoteDTO, ClientImportantNoteError>
> => {
  const normalized = normalizeImportantNote(note);
  try {
    return await DB_CLIENT.use.$transaction(async tx => {
      const owner = { client_user_id, stylist_account_id };
      const candidate = await tx.clientStylistPair.findUnique({
        where: { client_user_id_stylist_account_id: owner },
        select: { id: true },
      });
      if (!candidate || !(await lockConversation(tx, candidate.id))) {
        return normalized === null
          ? success({ note: null, updatedAt: null })
          : notPaired(client_user_id, stylist_account_id);
      }
      const pair = await tx.clientStylistPair.findUnique({
        where: { id: candidate.id },
        select: {
          id: true,
          client_user_id: true,
          stylist_account_id: true,
          status: true,
          client_user: { select: { is_active: true } },
          salon_origin_account_id: true,
          important_note_updated_at: true,
        },
      });
      if (
        !pair ||
        pair.client_user_id !== client_user_id ||
        pair.stylist_account_id !== stylist_account_id
      ) {
        return normalized === null
          ? success({ note: null, updatedAt: null })
          : notPaired(client_user_id, stylist_account_id);
      }
      if (
        normalized !== null &&
        (pair.status !== PairingStatusValue.ACTIVE ||
          !pair.client_user.is_active ||
          !(await clientPairAccessIsCurrent(
            pair,
            client_user_id,
            stylist_account_id,
            tx
          )))
      ) {
        return notPaired(client_user_id, stylist_account_id);
      }

      const currentTime = pair.important_note_updated_at?.getTime() ?? null;
      const expectedTime =
        expected_updated_at == null
          ? null
          : new Date(expected_updated_at).getTime();
      if (expected_updated_at !== undefined && expectedTime !== currentTime) {
        return failure({
          type: 'VALIDATION_ERROR' as const,
          field: 'note',
          message: VALIDATION_MESSAGES.visit.crmNoteChanged,
        });
      }
      // Legacy requests without a revision remain last-write-wins. A tombstone
      // preserves the revision through a clear so a stale create cannot pass CAS.
      const updatedAt = new Date(Math.max(Date.now(), (currentTime ?? 0) + 1));
      const result = await tx.clientStylistPair.updateMany({
        where:
          normalized === null
            ? { id: pair.id, ...owner }
            : {
                id: pair.id,
                ...activePairWhere(client_user_id, stylist_account_id),
              },
        data: {
          important_note: normalized,
          important_note_updated_at: updatedAt,
        },
      });
      if (result.count === 0) {
        return normalized === null
          ? success({ note: null, updatedAt: null })
          : notPaired(client_user_id, stylist_account_id);
      }
      return success({ note: normalized, updatedAt: updatedAt.toISOString() });
    });
  } catch (error) {
    return databaseFailure('upsertClientImportantNote_IO', error);
  }
};
