import { DB_CLIENT } from '@app/db/db.client';
import { lockActivePair } from '@app/db/lock-rows';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { TIME } from '@kernel/application/constants.config';
import type { DatabaseError } from '@kernel/application/common-errors.types';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type { ClientUnauthorizedAccessError } from '@kernel/domain/client/client-errors.types';
import type { PricingPlan } from '@kernel/domain/pricing/pricing.config';
import type {
  ClientCardPlanLockedError,
  VisitNotFoundError,
} from '@kernel/domain/visit/visit-errors.types';
import type { HistoryAccessDTO } from '@kernel/models/pricing/history-access.dto';
import {
  PairingStatusValue,
  type VisitRecordSource,
} from '@kernel/models/db_models.generated.dto';
import type {
  VisitRecordDTO,
  VisitResultPhotoDTO,
} from '@kernel/models/visit/visit.dto';
import { PRICING_POLICY } from '@kernel/policies/pricing.policy';
import { Prisma } from '../../../prisma/js-client';

export const VISIT_LIST_MAX_TAKE = 50;
export const VISIT_LIST_DEFAULT_TAKE = 20;

// Jeden kształt dociągania zdjęć efektu dla KAŻDEJ ścieżki oddającej VisitRecordDTO
// (lista, create, refetch po update-note): kolejność position → created_at jest
// częścią kontraktu DTO (resultPhotos[i].position rośnie), więc nie może się
// rozjechać między trzema miejscami.
// Prisma.validator zachowuje typ literalny (payload z result_photos wnioskowany
// w każdym call-site) i sprawdza kształt tu, nie dopiero przy użyciu.
export const VISIT_RESULT_PHOTOS_INCLUDE =
  Prisma.validator<Prisma.VisitRecordInclude>()({
    result_photos: {
      orderBy: [{ position: 'asc' }, { created_at: 'asc' }],
    },
  });

export type DbVisitResultPhoto = {
  id: string;
  visit_record_id: string;
  asset_url: string;
  position: number;
  created_at: Date;
};

export type DbVisitRecordWithPhotos = {
  id: string;
  client_user_id: string;
  visit_date: Date;
  service_note: string | null;
  source: VisitRecordSource;
  session_id: string | null;
  created_at: Date;
  result_photos: DbVisitResultPhoto[];
};

export type VisitAccessError =
  | VisitNotFoundError
  | ClientUnauthorizedAccessError
  | ClientCardPlanLockedError
  | DatabaseError;

export const mapPhotoToDTO = (
  photo: DbVisitResultPhoto
): VisitResultPhotoDTO => ({
  id: photo.id,
  visitRecordId: photo.visit_record_id,
  assetUrl: photo.asset_url,
  position: photo.position,
  createdAt: photo.created_at.toISOString(),
});

export const mapVisitToDTO = (
  visit: DbVisitRecordWithPhotos
): VisitRecordDTO => ({
  id: visit.id,
  clientUserId: visit.client_user_id,
  visitDate: visit.visit_date.toISOString(),
  serviceNote: visit.service_note,
  source: visit.source,
  sessionId: visit.session_id,
  resultPhotos: visit.result_photos.map(mapPhotoToDTO),
  createdAt: visit.created_at.toISOString(),
});

export const normalizeNullableText = (
  value: string | undefined
): string | null => {
  const trimmed = value?.trim() ?? '';
  return trimmed.length > 0 ? trimmed : null;
};

export const getHistoryAccess = (
  pricingPlan: PricingPlan
): HistoryAccessDTO => {
  const planConfig = PRICING_POLICY.utils.getPlanConfig(pricingPlan);
  const canViewHistory = PRICING_POLICY.utils.canViewHistory(planConfig);
  return {
    isLocked: !canViewHistory,
    canViewHistory,
    retentionDays: PRICING_POLICY.utils.getHistoryRetentionDays(planConfig),
  };
};

export const assertHistoryAccess = (
  pricingPlan: PricingPlan
): OperationResult<HistoryAccessDTO, ClientCardPlanLockedError> => {
  const historyAccess = getHistoryAccess(pricingPlan);
  if (!historyAccess.canViewHistory) {
    return failure({
      type: 'CLIENT_CARD_PLAN_LOCKED',
      planType: pricingPlan,
    });
  }
  return success(historyAccess);
};

export const findActivePairing = async ({
  client_user_id,
  stylist_account_id,
  tx,
}: {
  client_user_id: string;
  stylist_account_id: string;
  tx?: Prisma.TransactionClient;
}) =>
  (tx ?? DB_CLIENT.use).clientStylistPair.findFirst({
    where: {
      client_user_id,
      stylist_account_id,
      status: PairingStatusValue.ACTIVE,
      client_user: { is_active: true },
    },
    select: { id: true },
  });

export const requireActivePairing_IO = async ({
  client_user_id,
  stylist_account_id,
}: {
  client_user_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<true, ClientUnauthorizedAccessError | DatabaseError>
> => {
  try {
    const pairing = await findActivePairing({
      client_user_id,
      stylist_account_id,
    });
    if (!pairing) {
      return failure({
        type: 'CLIENT_UNAUTHORIZED_ACCESS',
        clientId: client_user_id,
        stylistAccountId: stylist_account_id,
      });
    }
    return success(true);
  } catch (error) {
    return databaseFailure('requireActivePairing_IO', error);
  }
};

// DECISION (nie usuwaj tego komentarza): IN-TRANSACTION revoke-race barrier dla ścieżek WRITE.
// requireActivePairing_IO / requireVisitAccess_IO robią pairing-check POZA tx (plain findFirst),
// więc revoke (UPDATE ClientStylistPair.status->REVOKED) może zacommitować MIĘDZY checkiem a samym
// zapisem → nota/foto/wizyta trafia do klientki, której parę właśnie odebrano (TOCTOU). Ten helper
// bierze FOR UPDATE na wierszu AKTYWNEJ pary (lockActivePair) WEWNĄTRZ tej samej tx co zapis: revoke
// albo czeka na nasz commit, albo poszedł pierwszy i EPQ wyklucza wiersz (już REVOKED) → null →
// CLIENT_UNAUTHORIZED_ACCESS. `requireActiveClient` dokłada do bariery ten sam warunek
// `client_user.is_active`, który sprawdza requireActivePairing_IO, więc predykaty są równe. Uwaga:
// to lustro PREDYKATU, nie lock na `users`: soft-delete klientki nie rusza pary, więc wyścig
// check→lock jest zwężony, nie zamknięty (zasięg i powód w lock-rows.ts przy fladze).
// Wywoływać PRZED zapisem, w tej samej tx.
// Lock-order: ClientStylistPair PRZED VisitRecord (patrz lock-rows.ts DECISION) — NIE odwracać.
export const requireActivePairingLocked_IO = async (
  tx: Prisma.TransactionClient,
  client_user_id: string,
  stylist_account_id: string
): Promise<OperationResult<true, ClientUnauthorizedAccessError>> => {
  const pairing = await lockActivePair(tx, client_user_id, stylist_account_id, {
    requireActiveClient: true,
  });
  if (!pairing) {
    return failure({
      type: 'CLIENT_UNAUTHORIZED_ACCESS',
      clientId: client_user_id,
      stylistAccountId: stylist_account_id,
    });
  }
  return success(true);
};

// Retention window cutoff shared by the read filter (buildVisitWhere) and the
// write gate (requireVisitAccess_IO) so both paths compute the boundary once.
// retentionDays <= 0 means "no cutoff": FREE (0) never reaches here (canViewHistory
// gate rejects earlier), full-history plans use -1.
export const retentionCutoff = (retentionDays: number): Date | null =>
  retentionDays > 0
    ? new Date(Date.now() - retentionDays * TIME.MS_PER_DAY)
    : null;

export const buildVisitWhere = ({
  client_user_id,
  stylist_account_id,
  retentionDays,
}: {
  client_user_id: string;
  stylist_account_id: string;
  retentionDays: number;
}): Prisma.VisitRecordWhereInput => {
  const cutoff = retentionCutoff(retentionDays);

  return {
    client_user_id,
    stylist_account_id,
    ...(cutoff && { visit_date: { gte: cutoff } }),
  };
};

export const loadVisitForStylist_IO = async ({
  visit_id,
  stylist_account_id,
}: {
  visit_id: string;
  stylist_account_id: string;
}): Promise<
  OperationResult<
    { id: string; client_user_id: string; visit_date: Date },
    VisitNotFoundError | DatabaseError
  >
> => {
  try {
    const visit = await DB_CLIENT.use.visitRecord.findFirst({
      where: { id: visit_id, stylist_account_id },
      select: { id: true, client_user_id: true, visit_date: true },
    });
    if (!visit) {
      return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
    }
    return success(visit);
  } catch (error) {
    return databaseFailure('loadVisitForStylist', error);
  }
};

export const requireVisitAccess_IO = async ({
  visit_id,
  stylist_account_id,
  stylist_pricing_plan,
  purpose = 'content',
}: {
  visit_id: string;
  stylist_account_id: string;
  stylist_pricing_plan: PricingPlan;
  /**
   * 'content' (domyślnie) — operacja może oddać treść wizyty, więc obowiązuje
   * cutoff retencji. 'destructive' — operacja tylko kasuje i nie zwraca treści,
   * więc cutoff jej nie dotyczy. Uzasadnienie: DECISION przy samym cutoffie.
   */
  purpose?: 'content' | 'destructive';
}): Promise<OperationResult<{ client_user_id: string }, VisitAccessError>> => {
  // DECISION (nie usuwaj tego komentarza): bramka PLANU obowiązuje — tak samo
  // jak cutoff retencji niżej — WYŁĄCZNIE ścieżki oddające TREŚĆ. Zwolnienie
  // `purpose: 'destructive'` było wcześniej zaimplementowane tylko przy
  // cutoffie, a ta bramka odpalała przed nim i ignorowała `purpose` — więc
  // zejście na plan bez historii (koniec 30-dniowego trialu Pro = ścieżka
  // domyślna) zamrażało wizyty i zdjęcia: nie do zobaczenia I nie do
  // skasowania, bez ścieżki realizacji żądania usunięcia. To dokładnie ten
  // stan, który DECISION przy cutoffie nazywa niedopuszczalnym: tier reguluje
  // WGLĄD, nie prawo do usunięcia, a stylistka jest administratorem tych
  // danych osobowych. Kasowanie nie oddaje ani jednego pola treści (zwraca
  // samo `{success:true}`), więc read-oracle z tego zwolnienia nie powstaje.
  const historyAccess = getHistoryAccess(stylist_pricing_plan);
  if (purpose !== 'destructive' && !historyAccess.canViewHistory) {
    return failure({
      type: 'CLIENT_CARD_PLAN_LOCKED',
      planType: stylist_pricing_plan,
    });
  }

  const visit = await loadVisitForStylist_IO({ visit_id, stylist_account_id });
  if (!visit.success) {
    return visit;
  }

  // DECISION (nie usuwaj tego komentarza): retencja read/write symetryczna, ale TYLKO
  // dla ścieżek, które oddają TREŚĆ. Ścieżka READ (getClientVisits_IO → buildVisitWhere)
  // ukrywa wizyty starsze niż okno retencji planu (cutoff). Bez tego guardu update-note
  // i add-photo mogłyby mutować — a update-note ECHOEM zwracać pełne DTO (service_note +
  // wszystkie result_photos) — wizyt spoza okna, których lista celowo nie pokazuje: write
  // stałby się read-oracle na treść zablokowaną tierem (np. PRO 90d trzymający visit_id
  // z czasów Studio). Ten sam VISIT_NOT_FOUND co read, bez existence-oracle. retencja<=0
  // (plan pełnej historii) = brak cutoff; FREE nie dochodzi (canViewHistory odrzuca wyżej).
  //
  // `purpose: 'destructive'` ZWALNIA z cutoffu i to nie jest furtka w tierze. Kasowanie
  // (delete-manual, result-photo/remove) nie oddaje ani jednego pola treści — zwraca samo
  // `{success:true}` — więc read-oracle z niego nie zrobisz. Wspólna bramka bez tego
  // rozróżnienia dawała stan, w którym wizyta spoza okna była nie do zobaczenia I nie do
  // skasowania: 404 na delete, wiersz zostaje w bazie na zawsze. Wystarczyło zejść
  // z pełnej historii na PRO, żeby własne notatki o klientce (dane osobowe, których
  // stylistka jest administratorem) stały się nieusuwalne przez produkt — bez ścieżki
  // realizacji żądania usunięcia i bez świadomości, że wciąż tam są. Właścicielka danych
  // MUSI mieć zawsze drogę do ich skasowania; tier reguluje wgląd, nie prawo do usunięcia.
  const cutoff = retentionCutoff(historyAccess.retentionDays);
  if (purpose !== 'destructive' && cutoff && visit.data.visit_date < cutoff) {
    return failure({ type: 'VISIT_NOT_FOUND', visitId: visit_id });
  }

  const pairing = await requireActivePairing_IO({
    client_user_id: visit.data.client_user_id,
    stylist_account_id,
  });
  if (!pairing.success) {
    return pairing;
  }

  return success({ client_user_id: visit.data.client_user_id });
};
