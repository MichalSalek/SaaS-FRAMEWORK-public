import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ClientUnauthorizedAccessError } from '@kernel/domain/client/client-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type { ClientCardPlanLockedError } from '@kernel/domain/visit/visit-errors.types';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';

type ClientCrmNoteResult = {
  note: string | null;
  updatedAt: string | null;
};

type ClientCrmNoteError =
  ClientUnauthorizedAccessError | ClientCardPlanLockedError | DatabaseError;

const normalizeCrmNote = (note: string): string | null => {
  const trimmed = note.trim();
  return trimmed.length > 0 ? trimmed : null;
};

const assertClientCardAccess = (
  pricingPlan: PricingPlan
): OperationResult<true, ClientCardPlanLockedError> => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  if (!PRICING_POLICY.utils.canViewHistory(planConfig)) {
    return failure({
      type: 'CLIENT_CARD_PLAN_LOCKED',
      planType: pricingPlan,
    });
  }
  return success(true);
};

const loadActivePair = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}) =>
  DB_CLIENT.use.clientStylistPair.findFirst({
    where: {
      client_user_id,
      stylist_account_id,
      status: PairingStatusValue.ACTIVE,
      client_user: { is_active: true },
    },
    select: {
      id: true,
      crm_note: true,
      crm_note_updated_at: true,
    },
  });

export const getClientCrmNote_IO = async ({
  stylist_account_id,
  client_user_id,
  stylist_pricing_plan,
}: {
  stylist_account_id: string;
  client_user_id: string;
  stylist_pricing_plan: PricingPlan;
}): Promise<OperationResult<ClientCrmNoteResult, ClientCrmNoteError>> => {
  const access = assertClientCardAccess(stylist_pricing_plan);
  if (!access.success) {
    return access;
  }

  try {
    const pair = await loadActivePair({ client_user_id, stylist_account_id });
    if (!pair) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }

    return success({
      note: pair.crm_note,
      updatedAt: pair.crm_note_updated_at?.toISOString() ?? null,
    });
  } catch (error) {
    return databaseFailure('getClientCrmNote_IO', error);
  }
};

export const upsertClientCrmNote_IO = async ({
  stylist_account_id,
  client_user_id,
  stylist_pricing_plan,
  note,
}: {
  stylist_account_id: string;
  client_user_id: string;
  stylist_pricing_plan: PricingPlan;
  note: string;
}): Promise<OperationResult<ClientCrmNoteResult, ClientCrmNoteError>> => {
  const normalized = normalizeCrmNote(note);

  // DECISION (nie usuwaj tego komentarza): pusta notatka = ŻĄDANIE USUNIĘCIA
  // i jako jedyna przechodzi przy planie bez dostępu do karty klientki.
  // Parytet z `purpose: 'destructive'` przy wizytach (visit-common.operations.ts):
  // tier reguluje WGLĄD, nie prawo do usunięcia. Bez tego wyjątku zejście na
  // plan bez historii (koniec trialu Pro) zostawiało stylistkę z notatkami
  // o klientkach — danymi osobowymi, których jest administratorką — których
  // nie widzi I nie potrafi skasować, mimo że eksport RODO nadal je oddaje.
  // Read-oracle z tego nie powstaje: gałąź kasująca nie zwraca ŻADNEJ treści
  // (zapisuje null i oddaje null), więc nie da się przez nią odczytać notatki
  // zablokowanej tierem. Zapis NIEPUSTEJ notatki zostaje pod bramką planu.
  if (normalized !== null) {
    const access = assertClientCardAccess(stylist_pricing_plan);
    if (!access.success) {
      return access;
    }
  }

  try {
    const updated = await DB_CLIENT.use.$transaction(async tx => {
      const updateResult = await tx.clientStylistPair.updateMany({
        where: {
          client_user_id,
          stylist_account_id,
          status: PairingStatusValue.ACTIVE,
          client_user: { is_active: true },
        },
        data: {
          crm_note: normalizeCrmNote(note),
          crm_note_updated_at: new Date(),
        },
      });
      if (updateResult.count === 0) {
        return null;
      }

      return tx.clientStylistPair.findFirst({
        where: {
          client_user_id,
          stylist_account_id,
        },
        select: {
          crm_note: true,
          crm_note_updated_at: true,
        },
      });
    });

    if (!updated) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }

    return success({
      note: updated.crm_note,
      updatedAt: updated.crm_note_updated_at?.toISOString() ?? null,
    });
  } catch (error) {
    return databaseFailure('upsertClientCrmNote_IO', error);
  }
};

/**
 * D4 (2026-09-05): kasowanie notatki CRM = własne dane stylistki.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Bramka = WYŁĄCZNIE własność wiersza pary (client_user_id + stylist_account_id z
 * sesji), bez `status: ACTIVE` i bez `client_user.is_active` — notatkę wolno
 * skasować przy parze PENDING/REVOKED (także po odmowie) i przy nieaktywnym koncie
 * klientki; bez bramki planu (parytet z gałęzią „pusta notatka" w upsert:
 * tier reguluje WGLĄD, nie prawo do usunięcia własnych danych). Retencja notatki
 * po zerwaniu (DECISION w revokePairingAccess_IO) bez zmian — nic nie kasuje się
 * samo, tylko ta jawna akcja. Odpowiedź = STAN PO OPERACJI (`note:null`), nigdy
 * licznik `count`: `deleted:true/false` zdradzałby po `client_user_id`, czy jakikolwiek
 * wiersz pary istnieje (anty-oracle, closing-review). updateMany z pełnym WHERE
 * własności = jeden statement, idempotentne (drugie wywołanie = ten sam wynik).
 */
export const deleteClientCrmNote_IO = async ({
  stylist_account_id,
  client_user_id,
}: {
  stylist_account_id: string;
  client_user_id: string;
}): Promise<
  OperationResult<{ note: null; updatedAt: null }, DatabaseError>
> => {
  try {
    await DB_CLIENT.use.clientStylistPair.updateMany({
      where: { client_user_id, stylist_account_id },
      data: { crm_note: null, crm_note_updated_at: null },
    });
    return success({ note: null, updatedAt: null });
  } catch (error) {
    return databaseFailure('deleteClientCrmNote_IO', error);
  }
};
