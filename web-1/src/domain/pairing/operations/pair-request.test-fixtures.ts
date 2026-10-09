/**
 * Wspólny mock scenariusza dla testów `pair-request.operations`.
 *
 * Wydzielony, bo plik testowy dobił do limitu `max-lines` (350) — helper jest
 * identyczny dla obu suit, więc zamiast go kopiować, obie go importują.
 * To NIE jest plik `.test.ts`: gdyby nim był, import z drugiej suity
 * zarejestrowałby jej testy po raz drugi.
 */

import { vi } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import { mockDb } from '../../../test-utils/mockApiHandler';

export const CLIENT_USER_ID = 'usr_test_0000000000000001';
export const STYLIST_ACCOUNT_ID = 'acc_test_0000000000000001';
export const PAIR_ID = 'pair_test_000000000000001';

export const mockCreateScenario = ({
  stylistExists = true,
  accountStatus = 'ACTIVE',
  ownerUserId = 'usr_owner_000000000000001',
  // Żywotność KONTA właścicielki (users.is_active) — sprawdzana jawnie, obok
  // account_status, patrz komentarz przy bramce w createPairRequest_IO.
  ownerIsActive = true,
  existingPair = null as null | {
    id: string;
    status: 'ACTIVE' | 'REVOKED' | 'PENDING';
    // Kto zerwał relację — rozstrzyga, czy klientka może poprosić ponownie.
    revoked_by?: 'STYLIST' | 'CLIENT' | null;
    // Czas POPRZEDNIEJ prośby — rozstrzyga, czy ponowienie mieści się w oknie,
    // w którym NIE powiadamiamy stylistki ponownie (patrz DECISION przy
    // `isRapidReassert`). Domyślnie dawno temu = powiadomienie należne.
    paired_at?: Date | null;
  },
  // CAS-flip REVOKED→PENDING: 1 = wygrany, 0 = przegrany wyścig (re-read).
  flipCount = 1,
  // Stan wiersza przy re-read po przegranym CAS (Codex HIGH: claim mógł
  // podnieść na ACTIVE między odczytem a flipem).
  reReadStatus = 'ACTIVE' as 'ACTIVE' | 'PENDING' | null,
} = {}) => {
  const create = vi.fn(async () => ({ id: PAIR_ID }));
  const updateMany = vi.fn(
    async (_args: {
      where: Record<string, unknown>;
      // `data` jest asertowane przez testy okna ponowienia (czy `paired_at`
      // zostało odświeżone), więc musi być w typie mocka.
      data?: Record<string, unknown>;
    }) => ({
      count: flipCount,
    })
  );
  // findUnique wołany 1× (existing) i — po przegranym CAS — 2× (re-read).
  let pairReads = 0;
  mockDb({
    stylistAccount: {
      findUnique: vi.fn(async () =>
        stylistExists
          ? {
              display_name: 'Ola Nails',
              created_by_user_id: ownerUserId,
              account_status: accountStatus,
              // Dane maila „prośba czeka" (select created_by_user w operacji).
              created_by_user: {
                email: 'ola@salon.pl',
                name: 'Ola',
                is_active: ownerIsActive,
              },
            }
          : null
      ),
    },
    clientStylistPair: {
      findUnique: vi.fn(async () => {
        pairReads += 1;
        if (pairReads === 1) {
          return existingPair === null
            ? null
            : {
                paired_at: new Date(Date.now() - 365 * TIME.MS_PER_DAY),
                ...existingPair,
              };
        }
        return reReadStatus === null ? null : { status: reReadStatus };
      }),
      create,
      updateMany,
    },
  });
  return { create, updateMany };
};
