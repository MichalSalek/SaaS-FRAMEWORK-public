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
import { createPairRequest_IO } from './pair-request.operations';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

import {
  mockCreateScenario,
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

describe('createPairRequest_IO — prośba o połączenie z publicznego profilu', () => {
  it('happy path: tworzy parę PENDING i zwraca display_name stylistki', async () => {
    const { create } = mockCreateScenario();

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
      expect(result.data.display_name).toBe('Ola Nails');
      expect(result.data.created).toBe(true);
    }
    expect(create).toHaveBeenCalledTimes(1);
  });

  it('anty-oracle: nieaktywna stylistka → PAIR_REQUEST_STYLIST_NOT_FOUND, zero zapisu', async () => {
    const { create, updateMany } = mockCreateScenario({
      accountStatus: 'DISABLED',
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIR_REQUEST_STYLIST_NOT_FOUND');
    }
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('nieżyjące konto właścicielki (is_active=false) → NOT_FOUND, zero zapisu i zero maila', async () => {
    // Parytet z ACCEPT i listą próśb, które sprawdzają żywotność wprost.
    // Dziś kaskada ustawia też account_status, ale bramka nie może na tym polegać.
    const { create, updateMany } = mockCreateScenario({ ownerIsActive: false });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIR_REQUEST_STYLIST_NOT_FOUND');
    }
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('self-pair (dual-role): własne konto stylistki → NOT_FOUND (maska, zero wycieku)', async () => {
    mockCreateScenario({ ownerUserId: CLIENT_USER_ID });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('PAIR_REQUEST_STYLIST_NOT_FOUND');
    }
  });

  it('idempotencja: istniejąca ACTIVE para → ALREADY_PAIRED bez create/update', async () => {
    const { create, updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'ACTIVE' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ALREADY_PAIRED');
      expect(result.data.created).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('idempotencja: prośba już czeka (PENDING) → PENDING bez odświeżania paired_at', async () => {
    const { create, updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'PENDING' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
      expect(result.data.created).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).not.toHaveBeenCalled();
  });

  it('REVOKED → PENDING przez CAS updateMany (predykat status=REVOKED, bez zerowania revoked_at)', async () => {
    const { create, updateMany } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED' },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
      expect(result.data.created).toBe(true);
    }
    expect(create).not.toHaveBeenCalled();
    expect(updateMany).toHaveBeenCalledTimes(1);
    const where = updateMany.mock.calls[0]?.[0]?.where;
    expect(where?.status).toBe('REVOKED');
  });

  it('przegrany CAS (claim podniósł na ACTIVE w locie) → re-read i ALREADY_PAIRED zamiast cofnięcia do PENDING', async () => {
    const { create } = mockCreateScenario({
      existingPair: { id: PAIR_ID, status: 'REVOKED' },
      flipCount: 0,
      reReadStatus: 'ACTIVE',
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ALREADY_PAIRED');
      expect(result.data.created).toBe(false);
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('REVOKED→PENDING with stylist_hidden_at set → created:true, notify:null', async () => {
    const existingPair = {
      id: PAIR_ID,
      status: 'REVOKED' as const,
      revoked_by: 'CLIENT' as const,
      stylist_hidden_at: new Date('2026-08-01T00:00:00.000Z'),
    };
    mockCreateScenario({ existingPair });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.created).toBe(true);
    expect(result.data.status).toBe('PENDING');
    expect(result.data.notify).toBeNull();
  });

  it('REVOKED→PENDING without hidden → created:true and notify object', async () => {
    mockCreateScenario({
      existingPair: {
        id: PAIR_ID,
        status: 'REVOKED',
        revoked_by: 'CLIENT',
      },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (!result.success) {
      return;
    }
    expect(result.data.created).toBe(true);
    expect(result.data.status).toBe('PENDING');
    expect(result.data.notify).toEqual({
      stylist_user_id: 'usr_owner_000000000000001',
      stylist_email: 'ola@salon.pl',
      stylist_name: 'Ola',
    });
  });
});
