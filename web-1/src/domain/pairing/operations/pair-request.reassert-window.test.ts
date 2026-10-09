/**
 * Okno ponowienia prośby o połączenie — regresja anty-nękaniowa.
 *
 * Wycofanie własnej prośby i natychmiastowe jej ponowienie to przejście, którym
 * steruje WYŁĄCZNIE klientka (cancel → REVOKED/CLIENT → create → PENDING).
 * Dopóki każdy obrót raportował `created:true`, jeden obrót = jeden wpis audytu
 * + jeden mail „prośba czeka" do stylistki, a stylistka nie miała żadnej obrony:
 * wycofana prośba znika z jej listy, więc nie ma czego odrzucić, a `revoke-access`
 * rusza tylko pary ACTIVE. Zmierzone w runtime: 60 maili w 3,6 s z jednego konta.
 *
 * Pełne uzasadnienie mechanizmu: DECISION przy `isRapidReassert`
 * w `pair-request.operations.ts`.
 */

import { describe, it, expect, vi } from 'vitest';
import { createPairRequest_IO } from './pair-request.operations';
import { TIME } from '@kernel/application/constants.config';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

import {
  mockCreateScenario,
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

describe('createPairRequest_IO — okno ponowienia po wycofaniu własnej prośby', () => {
  // Okno ponowienia — zmierzony wektor: klientka cyklowała wycofanie i ponowną
  // prośbę, a każdy obrót raportował `created:true`, czyli odpalał wpis audytu
  // i mail „prośba czeka" (60 maili w 3,6 s). Stylistka nie miała się jak bronić,
  // bo wycofana prośba znika z jej listy. Patrz DECISION przy `isRapidReassert`.
  it('ponowienie w oknie: stan wraca na PENDING, ale bez powiadomienia i bez odświeżania paired_at', async () => {
    const { updateMany } = mockCreateScenario({
      existingPair: {
        id: PAIR_ID,
        status: 'REVOKED',
        revoked_by: 'CLIENT',
        paired_at: new Date(),
      },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
      // created=false zamyka OBIE konsekwencje naraz: mail i wpis audytu
      // (endpoint gejtuje jedno i drugie na tej fladze).
      expect(result.data.created).toBe(false);
      expect(result.data.notify).toBeNull();
    }
    // Wiersz nadal wraca do PENDING (stylistka widzi prośbę w aplikacji)...
    expect(updateMany).toHaveBeenCalledTimes(1);
    const data = updateMany.mock.calls[0]?.[0]?.data as
      Record<string, unknown> | undefined;
    expect(data?.status).toBe('PENDING');
    // ...ale bez podbijania pozycji na liście (parytet z gałęzią PENDING).
    expect(data).not.toHaveProperty('paired_at');
  });

  it('ponowienie po oknie: powiadomienie należne, paired_at odświeżone', async () => {
    const { updateMany } = mockCreateScenario({
      existingPair: {
        id: PAIR_ID,
        status: 'REVOKED',
        revoked_by: 'CLIENT',
        paired_at: new Date(Date.now() - 2 * TIME.MS_PER_HOUR),
      },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.created).toBe(true);
      expect(result.data.notify).not.toBeNull();
    }
    const data = updateMany.mock.calls[0]?.[0]?.data as
      Record<string, unknown> | undefined;
    expect(data).toHaveProperty('paired_at');
  });
});
