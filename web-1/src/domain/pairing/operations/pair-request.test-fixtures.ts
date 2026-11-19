/**
 * Shared scenario mock for the pair-request.operations tests.
 *
 * Split out because the test file reached the max-lines limit (350). The helper
 * is the same for both suites, so both import it instead of copying it.
 * This is not a `.test.ts` file: if it were, importing it from the other suite
 * would register that suite's tests a second time.
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
    status: 'ACTIVE' | 'REVOKED' | 'PENDING' | 'CONTACT';
    // Kto zerwał relację — rozstrzyga, czy klientka może poprosić ponownie.
    revoked_by?: 'STYLIST' | 'CLIENT' | null;
    last_pair_request_at?: Date | null;
    // Time of the PREVIOUS request: decides whether a re-request falls inside the window in which the stylist
    // is NOT notified again (see `isRapidReassert`). Defaults to long ago = notification due.
    paired_at?: Date | null;
  },
  // CAS-flip REVOKED→PENDING: 1 = wygrany, 0 = przegrany wyścig (re-read).
  flipCount = 1,
  // Row state on the re-read after a lost CAS. A claim may have lifted the pair
  // to ACTIVE between the read and the flip.
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
