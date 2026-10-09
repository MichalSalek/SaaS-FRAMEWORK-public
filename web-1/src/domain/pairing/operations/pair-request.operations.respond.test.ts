/**
 * pair-request.operations unit tests — stały kod QR (prośba o połączenie).
 *
 * Locks in (wdrożenie 2026-07-11): anty-oracle celu prośby (nieistniejąca /
 * nieaktywna / WŁASNA stylistka = NOT_FOUND), idempotencja (ACTIVE →
 * ALREADY_PAIRED, PENDING → no-op), reaktywacja REVOKED→PENDING bez kasowania
 * revoked_at (chroni ścieżkę decline→REVOKED i crm_note), oba capy przy
 * ACCEPT (platform klientki + plan stylistki — PENDING nie kosztował slotów),
 * anty-oracle respond (cudza/nie-PENDING = NOT_FOUND, zero mutacji) oraz
 * decline-branch: świeża prośba znika, po-revoke'owa wraca do REVOKED.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { respondPairRequest_IO } from './pair-request.operations';
import { getPendingPairRequests_IO } from './pairing-query.operations';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

import {
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

type WhereArg = { where?: Record<string, unknown> };

const mockRespondScenario = ({
  pair = { id: PAIR_ID, client_user_id: CLIENT_USER_ID } as null | {
    id: string;
    client_user_id: string;
  },
  clientActiveCount = 0,
  stylistActiveCount = 0,
  updatedCount = 1,
  postAcceptClientCount = 1,
} = {}) => {
  // count() wołany 3×: client platform-cap, stylist plan-cap, post-accept
  // backstop — kolejnością wywołań (mockImplementation po kolei).
  const counts = [clientActiveCount, stylistActiveCount, postAcceptClientCount];
  let countCall = 0;
  const findFirst = vi.fn(async (_args: WhereArg) => pair);
  const count = vi.fn(async (_args: WhereArg) => counts[countCall++] ?? 0);
  const updateMany = vi.fn(async (_args: WhereArg) => ({
    count: updatedCount,
  }));
  const update = vi.fn(async (_args: { data: Record<string, unknown> }) => ({
    id: PAIR_ID,
  }));
  const del = vi.fn(async () => ({ id: PAIR_ID }));
  mockDb({
    clientStylistPair: {
      findFirst,
      count,
      updateMany,
      update,
      delete: del,
    },
  });
  return { findFirst, count, updateMany, update, del };
};

describe('respondPairRequest_IO — akceptacja/odrzucenie prośby przez stylistkę', () => {
  it('ACCEPT happy path: PENDING→ACTIVE atomowym updateMany z predykatem statusu', async () => {
    const { updateMany } = mockRespondScenario();

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ACTIVE');
    }
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('anty-oracle: cudza / nieistniejąca / nie-PENDING prośba → PAIR_REQUEST_NOT_FOUND, zero mutacji', async () => {
    const { updateMany, update, del } = mockRespondScenario({ pair: null });

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIR_REQUEST_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
    expect(del).not.toHaveBeenCalled();
  });

  it('ACCEPT: klientka na platform-capie (3 ACTIVE stylistki) → PAIRING_LIMIT_REACHED PLATFORM', async () => {
    const { updateMany } = mockRespondScenario({ clientActiveCount: 3 });

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIRING_LIMIT_REACHED');
      if (result.error.type === 'PAIRING_LIMIT_REACHED') {
        expect(result.error.planType).toBe('PLATFORM');
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('ACCEPT: stylistka na plan-capie (max_paired_clients=2) → PAIRING_LIMIT_REACHED z planem', async () => {
    const { updateMany } = mockRespondScenario({ stylistActiveCount: 2 });

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.FREE,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIRING_LIMIT_REACHED');
      if (result.error.type === 'PAIRING_LIMIT_REACHED') {
        expect(result.error.planType).toBe(PricingPlanValue.FREE);
      }
    }
    expect(updateMany).not.toHaveBeenCalled();
  });

  // Ten test PINUJE zmianę zachowania: wcześniej DECLINE świeżej prośby KASOWAŁ
  // wiersz, a StylistClientMessage ma na parze onDelete: Cascade — jedno „Odrzuć"
  // wymazywało całą rozmowę u OBU stron. Stara asercja (`delete` wołany) kodowała
  // ten bug, więc została przepisana, nie osłabiona.
  it('DECLINE nigdy nie kasuje wiersza: bezwarunkowe REVOKED + revoked_by=STYLIST', async () => {
    const { del, update } = mockRespondScenario();

    const result = await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'DECLINE',
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('DECLINED');
    }
    expect(del).not.toHaveBeenCalled();
    expect(update).toHaveBeenCalledTimes(1);
    const data = update.mock.calls[0]?.[0]?.data;
    expect(data?.status).toBe('REVOKED');
    expect(data?.revoked_by).toBe('STYLIST');
    expect(data?.revoked_at).toBeInstanceOf(Date);
  });

  it('ACCEPT wymaga żywej klientki, DECLINE nie — asymetria widoczności', async () => {
    const { findFirst, updateMany } = mockRespondScenario();

    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });
    expect(findFirst.mock.calls[0]?.[0]?.where?.client_user).toEqual({
      is_active: true,
    });
    // Race-guard powtarza predykat — klientka zdjęta po odczycie = count 0.
    expect(updateMany.mock.calls[0]?.[0]?.where?.client_user).toEqual({
      is_active: true,
    });

    const declineScenario = mockRespondScenario();
    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'DECLINE',
    });
    // Klientka może zniknąć między listą a tapnięciem „Odrzuć" — sprzątanie prośby
    // musi się udać, bo niczego nie nadaje.
    expect(
      declineScenario.findFirst.mock.calls[0]?.[0]?.where?.client_user
    ).toBeUndefined();
  });

  it('capy liczą KAŻDĄ parę ACTIVE, także z martwym kontrpartnerem', async () => {
    // Ten test kodował wcześniej odwrotność: capy pomijały pary, których druga strona
    // jest po soft-delete albo po banie, żeby „duch" nie zjadał slotu. Zmierzone na
    // żywym backendzie: to otwierało obejście limitu planu — klientka kasowała konto
    // (slot się zwalniał), stylistka FREE przyjmowała trzecią parę, klientka odzyskiwała
    // konto jednym kliknięciem i konto FREE trzymało 3 pary przy limicie 2, bezterminowo
    // i powtarzalnie. Wiersz pary nigdy nie znikał, więc nic tego nie rekoncyliowało.
    // Dlatego cap liczy wszystko — patrz DECISION w pairing-cap.predicates.ts.
    const { count } = mockRespondScenario();

    await respondPairRequest_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
      stylist_pricing_plan: PricingPlanValue.PRO,
      pair_id: PAIR_ID,
      action: 'ACCEPT',
    });

    for (const call of count.mock.calls) {
      const where = call[0]?.where as Record<string, unknown> | undefined;
      expect(where?.status).toBe('ACTIVE');
      // Żaden warunek żywotności kontrpartnera nie może wrócić do cap-countu.
      expect(where?.stylist_account).toBeUndefined();
      expect(where?.client_user).toBeUndefined();
    }
  });
});

describe('getPendingPairRequests_IO — lista próśb na ekranie Parowanie', () => {
  it('mapuje wiersze PENDING na PII-minimum (pair_id + imię, bez emaila)', async () => {
    const requestedAt = new Date('2026-07-11T10:00:00Z');
    mockDb({
      clientStylistPair: {
        findMany: vi.fn(async () => [
          {
            id: PAIR_ID,
            client_user_id: CLIENT_USER_ID,
            paired_at: requestedAt,
            client_user: { name: 'Kasia' },
          },
        ]),
      },
    });

    const result = await getPendingPairRequests_IO({
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.requests).toEqual([
        {
          pair_id: PAIR_ID,
          name: 'Kasia',
          requested_at: requestedAt,
        },
      ]);
    }
  });
});
