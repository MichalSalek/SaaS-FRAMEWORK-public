/**
 * SessionContainer shared-helpers unit tests (domain-unit).
 *
 * Covers the pure policy helpers that every session-container operation leans on —
 * with priority on the s22 additions (commit ee9987ff "TTL write-path + is_hidden
 * mask"): `isPastTtl` is THE new write-side TTL predicate (add-photo / set-note
 * reject effectively-expired sessions before the 6h expiry sweep lands), so its
 * truth table is pinned here once and the operations tests assert only the wiring.
 * Also pinned: viewer-side stylistNote masking (fail-safe default = masked),
 * clientName hydration (trim/blank→null), detail-DTO photo ordering + independent
 * photoCount, lifecycle-state predicates, and the `findActivePairing` WHERE shape
 * (status=ACTIVE + STYLIST_PUBLICLY_VISIBLE + client_user.is_active — the SM-1
 * scoping every client-actor write path relies on) incl. tx passthrough.
 */

import { describe, it, expect, vi } from 'vitest';
import { mockDb } from '../../../test-utils/mockApiHandler';
import {
  calculateExpiresAt,
  findActivePairing,
  isClosedOrExpired,
  isPastTtl,
  isShareableState,
  mapSessionToDetailDTO,
  mapSessionToDTO,
  resolveViewerSide,
  type PhotoWithOptionalGalleryRecord,
  type SessionRowWithClient,
} from './session-container-shared.operations';
import {
  AccountStatusValue,
  PairingStatusValue,
  SessionContainerLifecycleStateValue,
} from '@kernel/models/db_models.generated.dto';
import type { Prisma } from '../../../prisma/js-client';
import { TIME } from '@kernel/application/constants.config';

const CLIENT_ACCOUNT_ID = 'cli_test_0000000000000001';
const STYLIST_ACCOUNT_ID = 'acc_stylist_0000000000001';
const CLIENT_USER_ID = 'usr_client_00000000000001';
const SESSION_ID = 'sess_test_000000000000001';

const makeSessionRow = (
  overrides: Partial<SessionRowWithClient> = {}
): SessionRowWithClient =>
  ({
    id: SESSION_ID,
    client_account_id: CLIENT_ACCOUNT_ID,
    stylist_account_id: STYLIST_ACCOUNT_ID,
    name: null,
    lifecycle_state: SessionContainerLifecycleStateValue.SHARED,
    stylist_note: null,
    client_note: null,
    shared_at: null,
    expires_at: null,
    closed_at: null,
    created_at: new Date('2026-01-01T00:00:00.000Z'),
    updated_at: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  }) as SessionRowWithClient;

describe('isPastTtl — write-side TTL predicate (s22, finding sc-addphoto-1)', () => {
  it('null expires_at (DRAFT/READY — no TTL) → false', () => {
    expect(isPastTtl(null)).toBe(false);
  });

  it('future expires_at → false (session still live)', () => {
    expect(isPastTtl(new Date(Date.now() + TIME.MS_PER_HOUR))).toBe(false);
  });

  it('past expires_at → true (effectively terminal even if lifecycle still SHARED/ACTIVE)', () => {
    expect(isPastTtl(new Date(Date.now() - 1000))).toBe(true);
  });
});

describe('calculateExpiresAt — SHARE TTL write value', () => {
  it('adds N days to now (7d share window)', () => {
    const before = Date.now();
    const result = calculateExpiresAt(7).getTime();
    const after = Date.now();
    expect(result).toBeGreaterThanOrEqual(before + 7 * TIME.MS_PER_DAY);
    expect(result).toBeLessThanOrEqual(after + 7 * TIME.MS_PER_DAY);
  });
});

describe('resolveViewerSide — stylist-private field authorization', () => {
  it("viewer is the assigned stylist of THIS session → 'stylist'", () => {
    expect(
      resolveViewerSide({
        sessionStylistAccountId: STYLIST_ACCOUNT_ID,
        viewerStylistAccountId: STYLIST_ACCOUNT_ID,
      })
    ).toBe('stylist');
  });

  it("viewer is a DIFFERENT stylist → 'client' (masked)", () => {
    expect(
      resolveViewerSide({
        sessionStylistAccountId: STYLIST_ACCOUNT_ID,
        viewerStylistAccountId: 'acc_stylist_other_0000001',
      })
    ).toBe('client');
  });

  it("no viewer stylist account (client reader) → 'client'", () => {
    expect(
      resolveViewerSide({
        sessionStylistAccountId: STYLIST_ACCOUNT_ID,
        viewerStylistAccountId: undefined,
      })
    ).toBe('client');
  });

  it("session has no stylist (anonymous draft) → 'client' even for a stylist viewer", () => {
    expect(
      resolveViewerSide({
        sessionStylistAccountId: null,
        viewerStylistAccountId: STYLIST_ACCOUNT_ID,
      })
    ).toBe('client');
  });
});

describe('mapSessionToDTO — viewer-side masking + clientName hydration', () => {
  it('DEFAULT (no viewerSide) masks stylistNote — fail-safe for write paths', () => {
    const dto = mapSessionToDTO(makeSessionRow({ stylist_note: 'sekret' }), 2);
    expect(dto.stylistNote).toBeNull();
    // clientNote is two-sided by design — never masked.
    expect(dto.photoCount).toBe(2);
  });

  it("viewerSide 'client' masks stylistNote, keeps clientNote", () => {
    const dto = mapSessionToDTO(
      makeSessionRow({ stylist_note: 'sekret', client_note: 'moja notka' }),
      0,
      'client'
    );
    expect(dto.stylistNote).toBeNull();
    expect(dto.clientNote).toBe('moja notka');
  });

  it("viewerSide 'stylist' reveals stylistNote", () => {
    const dto = mapSessionToDTO(
      makeSessionRow({ stylist_note: 'sekret' }),
      0,
      'stylist'
    );
    expect(dto.stylistNote).toBe('sekret');
  });

  it('clientName: hydrated relation is trimmed; blank → null; missing relation → null', () => {
    const withName = makeSessionRow({
      client_account: { created_by_user: { name: '  Ala Kowalska  ' } },
    });
    expect(mapSessionToDTO(withName, 0).clientName).toBe('Ala Kowalska');

    const blank = makeSessionRow({
      client_account: { created_by_user: { name: '   ' } },
    });
    expect(mapSessionToDTO(blank, 0).clientName).toBeNull();

    expect(mapSessionToDTO(makeSessionRow(), 0).clientName).toBeNull();
  });
});

describe('mapSessionToDetailDTO — photo ordering + independent photoCount', () => {
  const makePhoto = (
    id: string,
    position: number,
    createdAt: string
  ): PhotoWithOptionalGalleryRecord =>
    ({
      id,
      session_id: SESSION_ID,
      gallery_record_id: `gr_${id}`,
      position,
      created_at: new Date(createdAt),
    }) as PhotoWithOptionalGalleryRecord;

  it('sorts photos by position, then created_at; photoCount stays the PASSED total (not photos.length)', () => {
    const photos = [
      makePhoto('b', 2, '2026-01-02T00:00:00.000Z'),
      makePhoto('a', 1, '2026-01-01T00:00:00.000Z'),
      // same position — created_at breaks the tie
      makePhoto('d', 3, '2026-01-04T00:00:00.000Z'),
      makePhoto('c', 3, '2026-01-03T00:00:00.000Z'),
    ];

    const dto = mapSessionToDetailDTO(makeSessionRow(), photos, 250);

    expect(dto.photos.map(p => p.id)).toEqual(['a', 'b', 'c', 'd']);
    // DECISION in the mapper: photos are capped (take:200) upstream, the count is
    // the uncapped independent total — a >200-photo session must not report 200.
    expect(dto.photoCount).toBe(250);
  });
});

describe('lifecycle-state predicates', () => {
  it('isClosedOrExpired: true only for CLOSED/EXPIRED', () => {
    expect(isClosedOrExpired(SessionContainerLifecycleStateValue.CLOSED)).toBe(
      true
    );
    expect(isClosedOrExpired(SessionContainerLifecycleStateValue.EXPIRED)).toBe(
      true
    );
    expect(isClosedOrExpired(SessionContainerLifecycleStateValue.DRAFT)).toBe(
      false
    );
    expect(isClosedOrExpired(SessionContainerLifecycleStateValue.SHARED)).toBe(
      false
    );
  });

  it('isShareableState: true only for DRAFT/READY', () => {
    expect(isShareableState(SessionContainerLifecycleStateValue.DRAFT)).toBe(
      true
    );
    expect(isShareableState(SessionContainerLifecycleStateValue.READY)).toBe(
      true
    );
    expect(isShareableState(SessionContainerLifecycleStateValue.SHARED)).toBe(
      false
    );
    expect(isShareableState(SessionContainerLifecycleStateValue.CLOSED)).toBe(
      false
    );
  });
});

describe('findActivePairing — the SM-1 scoped WHERE every write path relies on', () => {
  it('queries by client+stylist, status=ACTIVE, VISIBLE stylist AND active client user', async () => {
    const findFirst = vi.fn(async (_arg: unknown) => ({ id: 'pair_1' }));
    mockDb({ clientStylistPair: { findFirst } });

    const pair = await findActivePairing(CLIENT_USER_ID, STYLIST_ACCOUNT_ID);

    expect(pair).toEqual({ id: 'pair_1' });
    expect(findFirst).toHaveBeenCalledTimes(1);
    const call = findFirst.mock.calls[0]?.[0] as unknown as {
      where: {
        client_user_id: string;
        stylist_account_id: string;
        status: string;
        stylist_account: {
          account_status: string;
          created_by_user: { is_active: boolean };
        };
        client_user: { is_active: boolean };
      };
      select: { id: boolean };
    };
    expect(call.where.client_user_id).toBe(CLIENT_USER_ID);
    expect(call.where.stylist_account_id).toBe(STYLIST_ACCOUNT_ID);
    expect(call.where.status).toBe(PairingStatusValue.ACTIVE);
    // STYLIST_PUBLICLY_VISIBLE: an admin-banned (account_status flip) or
    // self-soft-deleted (is_active=false) stylist must NOT accept client writes.
    expect(call.where.stylist_account.account_status).toBe(
      AccountStatusValue.ACTIVE
    );
    expect(call.where.stylist_account.created_by_user.is_active).toBe(true);
    // SM-1: soft-deleted client leaves the pairing row ACTIVE — status alone is
    // never trusted.
    expect(call.where.client_user.is_active).toBe(true);
    expect(call.select).toEqual({ id: true });
  });

  it('uses the PASSED tx client when provided (in-TX re-validation path)', async () => {
    const txFindFirst = vi.fn(async () => null);
    const tx = {
      clientStylistPair: { findFirst: txFindFirst },
    } as unknown as Prisma.TransactionClient;
    // Module-level DB left UNMOCKED on purpose — if findActivePairing ignored tx,
    // the fail-loud proxy would throw instead of returning null.

    const pair = await findActivePairing(
      CLIENT_USER_ID,
      STYLIST_ACCOUNT_ID,
      tx
    );

    expect(pair).toBeNull();
    expect(txFindFirst).toHaveBeenCalledTimes(1);
  });
});
