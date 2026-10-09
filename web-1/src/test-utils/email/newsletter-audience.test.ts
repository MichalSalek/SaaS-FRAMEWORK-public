/**
 * Unit tests — newsletter audience sync (Resend Audiences broadcast list).
 *
 * Verifies: feature-flag by presence (both env vars) gates all I/O; confirmed
 * subscriber → contacts.create({unsubscribed:false}); unsubscribe →
 * contacts.update({unsubscribed:true}); every failure mode (API {error},
 * thrown/rejected, timeout) is reported and SWALLOWED (never throws — DB is the
 * consent SSOT). `resend`, `ENV_VARS`, and `reportIssueBackend` are mocked via
 * hoisted holders so each test controls config + client behavior with no network.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const h = vi.hoisted(() => ({
  envVars: {
    RESEND_MARKETING_API_KEY: '' as string,
    RESEND_AUDIENCE_ID: '' as string,
  },
  contacts: {
    create: vi.fn(),
    update: vi.fn(),
  },
  ResendCtor: vi.fn(),
}));

// Implementacja mocka MUSI byc zwyklà funkcjà, nie strzalkowà: kod produkcyjny wola
// `new Resend(...)`, a od vitest 5 mock z implementacjà strzalkowà nie jest
// konstruowalny („TypeError: ... is not a constructor"). Zwykla funkcja zwracajaca
// obiekt daje ten sam wynik przy `new` (konstruktor zwracajacy obiekt oddaje ten obiekt).
vi.mock('resend', () => ({
  Resend: h.ResendCtor.mockImplementation(function () {
    return { contacts: h.contacts };
  }),
}));
vi.mock('@app/environment/environment.config', () => ({ ENV_VARS: h.envVars }));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

import {
  addConfirmedSubscriberToAudience,
  markSubscriberUnsubscribedInAudience,
  __resetResendAudienceClientForTest,
} from '@app/email-handler/newsletter-audience';
import { reportIssueBackend } from '@app/debugger/error-handler';

const report = vi.mocked(reportIssueBackend);
const AUDIENCE = 'aud_123';
const EMAIL = 'confirmed@example.com';

/** Both env vars present → feature-flag ON. */
const enableSync = (): void => {
  h.envVars.RESEND_MARKETING_API_KEY = 're_full_marketing_key';
  h.envVars.RESEND_AUDIENCE_ID = AUDIENCE;
};

describe('newsletter-audience sync', () => {
  beforeEach(() => {
    h.envVars.RESEND_MARKETING_API_KEY = '';
    h.envVars.RESEND_AUDIENCE_ID = '';
    h.contacts.create.mockReset().mockResolvedValue({ data: {}, error: null });
    h.contacts.update.mockReset().mockResolvedValue({ data: {}, error: null });
    report.mockReset();
    __resetResendAudienceClientForTest();
    vi.useRealTimers();
  });

  // ── Feature-flag by presence ───────────────────────────────────────────────

  describe('feature-flag by presence (both env vars)', () => {
    it('no-ops when BOTH env vars are absent (add + unsubscribe)', async () => {
      await addConfirmedSubscriberToAudience(EMAIL);
      await markSubscriberUnsubscribedInAudience(EMAIL);
      expect(h.contacts.create).not.toHaveBeenCalled();
      expect(h.contacts.update).not.toHaveBeenCalled();
      expect(report).not.toHaveBeenCalled();
    });

    it('no-ops when only the key is present (audience id missing)', async () => {
      h.envVars.RESEND_MARKETING_API_KEY = 're_full_marketing_key';
      await addConfirmedSubscriberToAudience(EMAIL);
      expect(h.contacts.create).not.toHaveBeenCalled();
    });

    it('no-ops when only the audience id is present (key missing)', async () => {
      h.envVars.RESEND_AUDIENCE_ID = AUDIENCE;
      await addConfirmedSubscriberToAudience(EMAIL);
      expect(h.contacts.create).not.toHaveBeenCalled();
    });
  });

  // ── addConfirmedSubscriberToAudience ───────────────────────────────────────

  describe('addConfirmedSubscriberToAudience', () => {
    beforeEach(enableSync);

    it('creates the contact subscribed (unsubscribed:false), no report on success', async () => {
      await addConfirmedSubscriberToAudience(EMAIL);
      expect(h.contacts.create).toHaveBeenCalledWith({
        audienceId: AUDIENCE,
        email: EMAIL,
        unsubscribed: false,
      });
      expect(report).not.toHaveBeenCalled();
    });

    it('reports (mode error) and does NOT throw when the API returns {error}', async () => {
      h.contacts.create.mockResolvedValue({
        data: null,
        error: { name: 'application_error', message: 'boom' },
      });
      await expect(
        addConfirmedSubscriberToAudience(EMAIL)
      ).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({
          namespace: 'RESEND_AUDIENCE_SYNC',
          mode: 'error',
        })
      );
    });

    it('reports (mode error) and does NOT throw when the SDK rejects (network)', async () => {
      h.contacts.create.mockRejectedValue(new Error('ECONNRESET'));
      await expect(
        addConfirmedSubscriberToAudience(EMAIL)
      ).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'error' })
      );
    });

    it('times out (8s), reports, and does NOT throw when the SDK hangs', async () => {
      vi.useFakeTimers();
      h.contacts.create.mockReturnValue(new Promise(() => {})); // never resolves
      const pending = addConfirmedSubscriberToAudience(EMAIL);
      await vi.advanceTimersByTimeAsync(8000);
      await expect(pending).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'error' })
      );
    });
  });

  // ── markSubscriberUnsubscribedInAudience ───────────────────────────────────

  describe('markSubscriberUnsubscribedInAudience', () => {
    beforeEach(enableSync);

    it('updates the contact to unsubscribed:true, no report on success', async () => {
      await markSubscriberUnsubscribedInAudience(EMAIL);
      expect(h.contacts.update).toHaveBeenCalledWith({
        audienceId: AUDIENCE,
        email: EMAIL,
        unsubscribed: true,
      });
      expect(report).not.toHaveBeenCalled();
    });

    it('reports (mode warn — nothing to do) and does NOT throw when {error}', async () => {
      h.contacts.update.mockResolvedValue({
        data: null,
        error: { name: 'not_found', message: 'contact not in audience' },
      });
      await expect(
        markSubscriberUnsubscribedInAudience(EMAIL)
      ).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledTimes(1);
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'warn' })
      );
    });

    it('reports (mode warn) and does NOT throw when the SDK rejects', async () => {
      h.contacts.update.mockRejectedValue(new Error('ETIMEDOUT'));
      await expect(
        markSubscriberUnsubscribedInAudience(EMAIL)
      ).resolves.toBeUndefined();
      expect(report).toHaveBeenCalledWith(
        expect.objectContaining({ mode: 'warn' })
      );
    });
  });
});
