/**
 * Trwałość usunięcia klientki przez stylistkę (`revoked_by`).
 *
 * Osobna suita, bo `pair-request.operations.test.ts` dobiła do limitu max-lines,
 * a te przypadki i tak stanowią spójny temat: KTO zerwał relację decyduje o tym,
 * czy klientka może ją wskrzesić ponowną prośbą.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPairRequest_IO } from './pair-request.operations';
import {
  mockCreateScenario,
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

describe('createPairRequest_IO — kto zerwał relację, ten decyduje o powrocie', () => {
  it('zerwanie PRZEZ STYLISTKĘ jest nieodwracalne — ponowna prośba nie podnosi pary, tylko maskowany NOT_FOUND', async () => {
    // Regresja, którą ten test pinuje: KAŻDY wiersz REVOKED wracał do PENDING, a
    // PENDING otwiera komunikator — więc usunięta klientka jednym POST-em odzyskiwała
    // prawo pisania do skrzynki stylistki. Powrót jest możliwy wyłącznie przez
    // zeskanowanie kodu stylistki (jej zgoda), nie jednostronnie.
    const { create, updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED', revoked_by: 'STYLIST' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // Ten sam błąd co nieistniejąca/nieaktywna stylistka — klientka nie dowiaduje
      // się, czy została usunięta, czy konto zniknęło (anty-oracle).
      expect(result.error.type).toBe('PAIR_REQUEST_STYLIST_NOT_FOUND');
    }
    expect(updateMany).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
  });

  it('zerwanie PRZEZ KLIENTKĘ zostaje odwracalne — własna rezygnacja nie zamyka drogi powrotu', async () => {
    const { updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED', revoked_by: 'CLIENT' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });

  it('wiersz sprzed kolumny revoked_by (NULL) zachowuje się jak zerwanie po stronie klientki', async () => {
    // Świadomie NIE blokujemy wstecznie relacji, o których nie wiemy, kto je zerwał.
    const { updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED', revoked_by: null },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(updateMany).toHaveBeenCalledTimes(1);
  });
});
