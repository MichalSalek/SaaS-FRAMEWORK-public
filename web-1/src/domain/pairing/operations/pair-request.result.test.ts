/**
 * Przegrany wyścig dwóch pierwszych próśb tej samej pary (P2002).
 *
 * Osobna suita, bo `pair-request.operations.test.ts` jest przy limicie max-lines,
 * a ten przypadek dotyczy jednego, zwartego tematu: co dostaje klientka, której
 * `create` przegrał unique-violation.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import { createPairRequest_IO } from './pair-request.operations';
import {
  CLIENT_USER_ID,
  STYLIST_ACCOUNT_ID,
  PAIR_ID,
} from './pair-request.test-fixtures';

vi.mock('@app/pricing/plan-config.cache', () => ({
  getPlanConfig: vi.fn(async () => ({ max_paired_clients: 2 })),
}));

const mockRaceScenario = ({
  winner = {
    id: PAIR_ID,
    status: 'PENDING',
    stylist_account: { display_name: 'Ola Nails' },
  } as unknown,
  reReadThrows = false,
} = {}) => {
  let pairReads = 0;
  const findUnique = vi.fn(async () => {
    pairReads += 1;
    // 1. odczyt = sprawdzenie istniejącej pary (brak → create), 2. = re-read po P2002.
    if (pairReads === 1) {
      return null;
    }
    if (reReadThrows) {
      throw new Error('connection lost');
    }
    return winner;
  });
  mockDb({
    stylistAccount: {
      findUnique: vi.fn(async () => ({
        display_name: 'Ola Nails',
        created_by_user_id: 'usr_owner_000000000000001',
        account_status: 'ACTIVE',
        created_by_user: { email: 'ola@salon.pl', name: 'Ola' },
      })),
    },
    clientStylistPair: {
      findUnique,
      create: vi.fn(async () => {
        // Kształt Prisma known-request-error wykrywany strukturalnie (isP2002).
        throw Object.assign(new Error('Unique constraint failed'), {
          code: 'P2002',
        });
      }),
      updateMany: vi.fn(async () => ({ count: 0 })),
    },
  });
  return { findUnique };
};

describe('createPairRequest_IO — P2002 (dwa urządzenia / retry POST)', () => {
  it('przegrany wyścig dostaje REALNE pair_id i display_name zwycięzcy, nie nulle', async () => {
    // Regresja: wcześniej gałąź P2002 zwracała pair_id:null + display_name:null,
    // więc UI zostawało bez uchwytu do prośby (anulowanie, klucz lejka PostHog).
    mockRaceScenario();

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
      expect(result.data.pair_id).toBe(PAIR_ID);
      expect(result.data.display_name).toBe('Ola Nails');
      // Zwycięzca wyścigu już policzył lejek — przegrany nie pompuje go drugi raz.
      expect(result.data.created).toBe(false);
      expect(result.data.notify).toBeNull();
    }
  });

  it('gdy claim podniósł parę tuż po zwycięzcy → ALREADY_PAIRED', async () => {
    mockRaceScenario({
      winner: {
        id: PAIR_ID,
        status: 'ACTIVE',
        stylist_account: { display_name: 'Ola Nails' },
      },
    });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('ALREADY_PAIRED');
      expect(result.data.pair_id).toBe(PAIR_ID);
    }
  });

  it('awaria re-readu degraduje odpowiedź, ale NIE zamienia sukcesu w 500', async () => {
    mockRaceScenario({ reReadThrows: true });

    const result = await createPairRequest_IO({
      client_user_id: CLIENT_USER_ID,
      stylist_account_id: STYLIST_ACCOUNT_ID,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.status).toBe('PENDING');
      expect(result.data.pair_id).toBeNull();
    }
  });
});
