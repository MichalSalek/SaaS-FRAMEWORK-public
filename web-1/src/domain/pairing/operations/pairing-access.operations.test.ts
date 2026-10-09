/**
 * revokePairingAccess_IO — zerwanie pary zamyka sesje TĄ SAMĄ ścieżką co
 * „Zamknij sesję", więc musi też dowieźć jej efekt CRM: VisitRecord dla sesji
 * UDOSTĘPNIONYCH. Ta suita pinuje właśnie ten efekt (wcześniej ginął po cichu).
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  AccountTypeValue,
  PairingStatusValue,
} from '@kernel/models/db_models.generated.dto';

const scheduleArchive = vi.fn();
vi.mock('@domain/visit/operations/visit-session-archive.operations', () => ({
  scheduleSessionVisitArchiveBestEffort: (args: { session_id: string }) =>
    scheduleArchive(args),
}));

import { revokePairingAccess_IO } from './pairing-access.operations';

const CLIENT_USER_ID = 'usr_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';

const mockRevokeScenario = (
  sessions: Array<{ id: string; shared_at: Date | null }>
) => {
  const updateMany = vi.fn(async () => ({ count: sessions.length }));
  const pairUpdate = vi.fn(async (_args: unknown) => ({
    id: 'pair_test_000000000000001',
  }));
  mockDb({
    clientStylistPair: {
      findFirst: vi.fn(async () => ({
        id: 'pair_test_000000000000001',
        client_user_id: CLIENT_USER_ID,
        stylist_account_id: STYLIST_ACCOUNT_ID,
      })),
      update: pairUpdate,
    },
    favoriteGalleryRecord: { deleteMany: vi.fn(async () => ({ count: 0 })) },
    clientAccount: {
      findUnique: vi.fn(async () => ({
        client_account_id: 'cli_test_0000000000000001',
      })),
    },
    sessionContainer: { findMany: vi.fn(async () => sessions), updateMany },
  });
  return { updateMany, pairUpdate };
};

describe('revokePairingAccess_IO — archiwum wizyt przeżywa zerwanie pary', () => {
  it('udostępniona sesja domknięta przez revoke trafia do VisitRecord', async () => {
    scheduleArchive.mockClear();
    mockRevokeScenario([
      { id: 'ses_shared_0000000000001', shared_at: new Date() },
    ]);

    const result = await revokePairingAccess_IO({
      current_user_id: 'usr_stylist_00000000001',
      current_stylist_account_id: STYLIST_ACCOUNT_ID,
      target_user_id: CLIENT_USER_ID,
    });

    expect(result.success).toBe(true);
    expect(scheduleArchive).toHaveBeenCalledTimes(1);
    expect(scheduleArchive).toHaveBeenCalledWith({
      session_id: 'ses_shared_0000000000001',
    });
  });

  it('nigdy nieudostępniony draft NIE tworzy wizyty (parytet z gate lifecycle)', async () => {
    scheduleArchive.mockClear();
    mockRevokeScenario([{ id: 'ses_draft_00000000000001', shared_at: null }]);

    const result = await revokePairingAccess_IO({
      current_user_id: CLIENT_USER_ID,
      target_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(scheduleArchive).not.toHaveBeenCalled();
  });
});

describe('revokePairingAccess_IO — KTO zerwał relację (strona zapisu)', () => {
  // Ta suita pinuje ZAPIS `revoked_by`, nie odczyt. Wcześniej autor był brany
  // z obecności `current_stylist_account_id`, czyli z aktywnej roli wołającego —
  // a gałąź kliencka tej operacji jest celowo rola-agnostyczna. Użytkownik dwuroli
  // odpinający WŁASNĄ stylistkę zapisywał więc `STYLIST` i sam blokował sobie
  // powrót na zawsze (CAS REVOKED->PENDING odrzuca zerwania po stronie stylistki).
  const stamped = (
    pairUpdate: ReturnType<typeof mockRevokeScenario>['pairUpdate']
  ) =>
    (
      pairUpdate.mock.calls[0]?.[0] as
        { data: { revoked_by: string } } | undefined
    )?.data.revoked_by;

  it('stylistka usuwa klientkę → STYLIST', async () => {
    const { pairUpdate } = mockRevokeScenario([]);

    const result = await revokePairingAccess_IO({
      current_user_id: 'usr_stylist_00000000001',
      current_stylist_account_id: STYLIST_ACCOUNT_ID,
      target_user_id: CLIENT_USER_ID,
    });

    expect(result.success).toBe(true);
    expect(stamped(pairUpdate)).toBe('STYLIST');
  });

  it('klientka odpina stylistkę → CLIENT', async () => {
    const { pairUpdate } = mockRevokeScenario([]);

    const result = await revokePairingAccess_IO({
      current_user_id: CLIENT_USER_ID,
      target_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(stamped(pairUpdate)).toBe('CLIENT');
  });

  it('DWUROLA: użytkownik w roli STYLISTKI odpina WŁASNĄ stylistkę → CLIENT, nie STYLIST', async () => {
    // Dokładnie przypadek, który zamykał drogę powrotu osobie naciskającej przycisk:
    // wołający jest klientem dopasowanej pary, choć wystąpił z konta stylistki.
    const { pairUpdate } = mockRevokeScenario([]);

    const result = await revokePairingAccess_IO({
      current_user_id: CLIENT_USER_ID,
      current_stylist_account_id: 'acc_wlasne_konto_stylistki',
      target_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    expect(stamped(pairUpdate)).toBe('CLIENT');
  });
});

describe('revokePairingAccess_IO — D1 idempotent revoke', () => {
  const pairUpdateData = (
    pairUpdate: ReturnType<typeof mockRevokeScenario>['pairUpdate']
  ) =>
    (
      pairUpdate.mock.calls[0]?.[0] as
        | {
            data: { status: string; revoked_by: string };
          }
        | undefined
    )?.data;

  it('ACTIVE own pair as stylist → success + $transaction REVOKED / revoked_by STYLIST', async () => {
    const { pairUpdate } = mockRevokeScenario([]);

    const result = await revokePairingAccess_IO({
      current_user_id: 'usr_stylist_00000000001',
      current_stylist_account_id: STYLIST_ACCOUNT_ID,
      target_user_id: CLIENT_USER_ID,
    });

    expect(result).toEqual({ success: true, data: { success: true } });
    expect(pairUpdate).toHaveBeenCalledTimes(1);
    expect(pairUpdateData(pairUpdate)).toEqual(
      expect.objectContaining({
        status: PairingStatusValue.REVOKED,
        revoked_by: AccountTypeValue.STYLIST,
      })
    );
  });

  it('ACTIVE own pair as client → success + $transaction REVOKED / revoked_by CLIENT', async () => {
    const { pairUpdate } = mockRevokeScenario([]);

    const result = await revokePairingAccess_IO({
      current_user_id: CLIENT_USER_ID,
      target_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result).toEqual({ success: true, data: { success: true } });
    expect(pairUpdate).toHaveBeenCalledTimes(1);
    expect(pairUpdateData(pairUpdate)).toEqual(
      expect.objectContaining({
        status: PairingStatusValue.REVOKED,
        revoked_by: AccountTypeValue.CLIENT,
      })
    );
  });

  it('findFirst null (already REVOKED / PENDING / foreign / nonexistent) → success, no $transaction', async () => {
    // No tx models: if $transaction ran, the setup proxy would throw "not mocked"
    // on favoriteGalleryRecord / clientStylistPair.update.
    const findFirst = vi.fn(async () => null);
    const pairUpdate = vi.fn();
    mockDb({
      clientStylistPair: { findFirst, update: pairUpdate },
    });

    const result = await revokePairingAccess_IO({
      current_user_id: 'usr_stylist_00000000001',
      current_stylist_account_id: STYLIST_ACCOUNT_ID,
      target_user_id: CLIENT_USER_ID,
    });

    expect(result).toEqual({ success: true, data: { success: true } });
    expect(findFirst).toHaveBeenCalledTimes(1);
    expect(pairUpdate).not.toHaveBeenCalled();
  });

  it('no target at all → PAIRING_SESSION_NOT_FOUND (unchanged)', async () => {
    const result = await revokePairingAccess_IO({
      current_user_id: CLIENT_USER_ID,
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error).toEqual({
        type: 'PAIRING_SESSION_NOT_FOUND',
        sessionId: '',
      });
    }
  });
});
