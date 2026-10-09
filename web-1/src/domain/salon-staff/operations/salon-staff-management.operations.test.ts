/**
 * inviteStaffMember_IO unit tests — definicja zajętego miejsca (seat) + kto może być zaproszony.
 *
 * Testy jadą PRZEZ prawdziwą operację (proxy DB_CLIENT z globalnego setupu), a `count`
 * i `findFirst` są zamockowane BEHAWIORALNIE: warunek WHERE jest realnie stosowany do
 * wierszy-fixture, więc usunięcie klauzuli z kodu wywala test — to nie snapshot argumentów.
 *
 * Domykane regresje:
 *  - F1: martwe konto (self-delete / ban admina) NIE MOŻE trzymać płatnego miejsca Studio —
 *    inaczej właścicielka na limicie 9 dostaje LIMIT_REACHED i nie ma jak slotu odzyskać.
 *  - F2a: zaproszenie nie wymaga zgody zapraszanej, więc do zespołu wolno wciągnąć wyłącznie
 *    konto z profilem stylistki; konto klienckie musi wpaść w maskowanie anty-enumeracyjne.
 *  - F2b: odpowiedź 201 nie może być wyrocznią „e-mail → imię + avatar".
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  inviteStaffMember_IO,
  removeStaffMember_IO,
} from './salon-staff-management.operations';

const ACCOUNT_ID = 'sa_test_0000000000000001';
const OWNER_USER_ID = 'usr_owner_00000000000001';
const INVITEE_USER_ID = 'usr_invitee_000000000001';
const INVITEE_EMAIL = 'nowa.stylistka@example.com';

type SeatRow = {
  stylist_account_id: string;
  is_active: boolean;
  user: { is_active: boolean; disabled_at: Date | null };
};

const liveSeat = (): SeatRow => ({
  stylist_account_id: ACCOUNT_ID,
  is_active: true,
  user: { is_active: true, disabled_at: null },
});

const deadUserSeat = (): SeatRow => ({
  stylist_account_id: ACCOUNT_ID,
  is_active: true,
  // Self-delete (Model A) zeruje User.is_active i stempluje deleted_at.
  user: { is_active: false, disabled_at: null },
});

const bannedUserSeat = (): SeatRow => ({
  stylist_account_id: ACCOUNT_ID,
  is_active: true,
  user: { is_active: true, disabled_at: new Date('2026-07-05T00:00:00.000Z') },
});

/**
 * Behawioralny `count`: stosuje WHERE (płaskie skalary + zagnieżdżony `user`) do wierszy
 * fixture, tak jak zrobiłby to Postgres. Dzięki temu test mierzy DEFINICJĘ miejsca, a nie
 * literał w wywołaniu.
 */
const behavioralCount = (rows: SeatRow[]) =>
  vi.fn(async (arg: { where: Record<string, unknown> }) => {
    const { user: userWhere, ...scalars } = arg.where as {
      user?: Record<string, unknown>;
    } & Record<string, unknown>;
    return rows.filter(row => {
      const scalarsMatch = Object.entries(scalars).every(
        ([key, value]) =>
          (row as unknown as Record<string, unknown>)[key] === value
      );
      if (!scalarsMatch) {
        return false;
      }
      if (!userWhere) {
        return true;
      }
      return Object.entries(userWhere).every(
        ([key, value]) =>
          (row.user as unknown as Record<string, unknown>)[key] === value
      );
    }).length;
  });

const createdStaffRow = {
  id: 'stf_test_0000000000000001',
  stylist_account_id: ACCOUNT_ID,
  user_id: INVITEE_USER_ID,
  role: 'EMPLOYEE' as const,
  permissions: ['GALLERY_VIEW'],
  invited_at: new Date('2026-08-01T10:00:00.000Z'),
  accepted_at: null,
  is_active: true,
};

/** Behawioralny lookup zapraszanej: honoruje is_active/disabled_at ORAZ obecność profilu stylistki. */
const behavioralUserFindFirst = (
  candidate: {
    id: string;
    is_active: boolean;
    disabled_at: Date | null;
    hasStylistAccount: boolean;
  } | null
) =>
  vi.fn(async (arg: { where: Record<string, unknown> }) => {
    if (!candidate) {
      return null;
    }
    const where = arg.where as {
      is_active?: boolean;
      disabled_at?: Date | null;
      stylist_account?: { isNot: null } | null;
    };
    if (where.is_active === true && !candidate.is_active) {
      return null;
    }
    if (where.disabled_at === null && candidate.disabled_at !== null) {
      return null;
    }
    if (where.stylist_account && !candidate.hasStylistAccount) {
      return null;
    }
    return { id: candidate.id, email: INVITEE_EMAIL };
  });

const stylistCandidate = {
  id: INVITEE_USER_ID,
  is_active: true,
  disabled_at: null,
  hasStylistAccount: true,
};

const mockInviteDb = ({
  seats,
  candidate,
}: {
  seats: SeatRow[];
  candidate: Parameters<typeof behavioralUserFindFirst>[0];
}) => {
  const create = vi.fn(async (_args: unknown) => createdStaffRow);
  mockDb({
    stylistAccount: {
      findUnique: async () => ({
        created_by_user_id: OWNER_USER_ID,
        paid_staff_seats: 0,
      }),
    },
    user: { findFirst: behavioralUserFindFirst(candidate) },
    staffMember: {
      count: behavioralCount(seats),
      findUnique: async () => null,
      create,
    },
  });
  return { create };
};

describe('inviteStaffMember_IO — limit liczy KAŻDE członkostwo, także po martwym koncie', () => {
  it('STUDIO na limicie 9 (w tym konto skasowane i zbanowane): zaproszenie ODRZUCONE', async () => {
    // Ten test kodował wcześniej odwrotność — martwe konta nie liczyły się do limitu,
    // więc zaproszenie przechodziło. To otwierało trwałe przekroczenie: wiersz
    // członkostwa nie znikał, więc po powrocie konta salon miał 10 miejsc przy limicie 9,
    // a nic tego nie rekoncyliowało (patrz DECISION przy `liveStaffSeatWhere`).
    // Zajęte miejsce zwalnia się usunięciem z rostera, nie śmiercią konta.
    const seats = [
      ...Array.from({ length: 7 }, liveSeat),
      deadUserSeat(),
      bannedUserSeat(),
    ];
    mockInviteDb({ seats, candidate: stylistCandidate });

    const result = await inviteStaffMember_IO({
      email: INVITEE_EMAIL,
      role: 'EMPLOYEE',
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SALON_STAFF_LIMIT_REACHED');
    }
  });

  it('STUDIO z 9 żywymi członkiniami: limit faktycznie osiągnięty', async () => {
    mockInviteDb({
      seats: Array.from({ length: 9 }, liveSeat),
      candidate: stylistCandidate,
    });

    const result = await inviteStaffMember_IO({
      email: INVITEE_EMAIL,
      role: 'EMPLOYEE',
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('SALON_STAFF_LIMIT_REACHED');
    }
  });
});

describe('inviteStaffMember_IO — kogo wolno wciągnąć do zespołu (F2)', () => {
  it('konto klienckie (bez profilu stylistki) nie da się zapisać do salonu', async () => {
    const { create } = mockInviteDb({
      seats: [],
      candidate: { ...stylistCandidate, hasStylistAccount: false },
    });

    const result = await inviteStaffMember_IO({
      email: INVITEE_EMAIL,
      role: 'EMPLOYEE',
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      // Maskowanie anty-enumeracyjne: ten sam neutralny błąd co dla nieistniejącego adresu.
      expect(result.error.type).toBe('SALON_STAFF_ALREADY_EXISTS');
    }
    expect(create).not.toHaveBeenCalled();
  });

  it('zapis zaproszenia NIE dociąga danych osobowych zapraszanej (brak wyroczni e-mail → imię)', async () => {
    // Asercja celowo na ARGUMENCIE wywołania, nie na zwróconym DTO. Wersja
    // sprawdzająca `result.data.staff.user === undefined` NIE MOGŁA nie przejść:
    // mock `create` ignoruje argumenty i zwraca wiersz bez klucza `user`, więc pole
    // było puste ze względów strukturalnych, a nie dlatego, że operacja przestała
    // je pobierać. Przywrócenie `include: { user: … }` zostawiłoby taki test zielony
    // i wyrocznia e-mail → imię + avatar wróciłaby niezauważona.
    const { create } = mockInviteDb({ seats: [], candidate: stylistCandidate });

    const result = await inviteStaffMember_IO({
      email: INVITEE_EMAIL,
      role: 'EMPLOYEE',
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(true);
    const createArgs = create.mock.calls[0]?.[0] as
      { include?: unknown; select?: unknown } | undefined;
    expect(createArgs).toBeDefined();
    // Ani include, ani select nie mają prawa wciągnąć relacji `user` do odpowiedzi.
    expect(JSON.stringify(createArgs?.include ?? {})).not.toContain('user');
    expect(JSON.stringify(createArgs?.select ?? {})).not.toContain('user');
    if (result.success) {
      expect(result.data.staff.user_id).toBe(INVITEE_USER_ID);
    }
  });
});

describe('removeStaffMember_IO — D1 idempotent remove', () => {
  const STAFF_ID = 'stf_test_0000000000000001';

  it('count 0 → success({success:true}), not SALON_STAFF_NOT_FOUND', async () => {
    mockDb({
      staffMember: {
        deleteMany: vi.fn(async () => ({ count: 0 })),
      },
    });

    const result = await removeStaffMember_IO({
      staffId: STAFF_ID,
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result).toEqual({ success: true, data: { success: true } });
  });

  it('count 1 → success({success:true})', async () => {
    mockDb({
      staffMember: {
        deleteMany: vi.fn(async () => ({ count: 1 })),
      },
    });

    const result = await removeStaffMember_IO({
      staffId: STAFF_ID,
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result).toEqual({ success: true, data: { success: true } });
  });

  it('DB throw → DATABASE_ERROR', async () => {
    mockDb({
      staffMember: {
        deleteMany: vi.fn(async () => {
          throw new Error('connection reset');
        }),
      },
    });

    const result = await removeStaffMember_IO({
      staffId: STAFF_ID,
      accountId: ACCOUNT_ID,
      pricingPlan: 'STUDIO',
    });

    expect(result.success).toBe(false);
    if (!result.success) {
      expect(result.error.type).toBe('DATABASE_ERROR');
    }
  });
});
