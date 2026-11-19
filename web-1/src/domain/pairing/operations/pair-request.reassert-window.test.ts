/**
 * Re-request window: anti-harassment regression.
 *
 * Cancelling one's own request and immediately re-sending it is a transition controlled ONLY by the client
 * (cancel -> REVOKED/CLIENT -> create -> PENDING). While every turn reported `created:true`, one turn meant
 * one audit entry plus one "request waiting" mail to the stylist, and she had no defence: a cancelled request
 * leaves her list, so there is nothing to decline, and `revoke-access` only touches ACTIVE pairs. Measured
 * live: 60 mails in 3.6 s from one account.
 *
 * Full rationale: the reassert-window DECISION at `isRapidReassert` in `pair-request.operations.ts`.
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
  it.each([true, false])(
    'distinguishes a reasserted CONTACT request from the first request (%s)',
    async reasserted => {
      mockCreateScenario({
        existingPair: {
          id: PAIR_ID,
          status: 'CONTACT',
          paired_at: new Date(),
          last_pair_request_at: reasserted ? new Date() : null,
        },
      });
      const result = await createPairRequest_IO({
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: STYLIST_ACCOUNT_ID,
      });
      expect(result).toMatchObject({
        success: true,
        data: { status: 'PENDING', created: !reasserted },
      });
      if (result.success) {
        expect(result.data.notify !== null).toBe(!reasserted);
      }
    }
  );
  // Reassert window: the measured vector was a client cycling cancel and re-request, each turn reporting
  // `created:true` (audit entry plus "request waiting" mail; 60 mails in 3.6 s). See the DECISION at
  // `isRapidReassert`.
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
    // ...but without bumping list position (same as the PENDING branch).
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
