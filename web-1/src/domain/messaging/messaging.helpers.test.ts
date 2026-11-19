/**
 * Unit tests for messaging.helpers. Party resolution is the IDOR boundary.
 *
 * resolvePairSide decides whether the caller is a side of the pair and which
 * side. That drives sender_type, the counterpart and unread. A mistake here is
 * either a leak (a stranger reads or writes someone else's thread) or a wrong
 * message attribution. Pinned: client side, stylist side, and a non-party
 * returns null (mapped to PAIR_NOT_FOUND).
 */

import { describe, it, expect } from 'vitest';
import { StylistClientMessageSenderValue } from '@kernel/models/messaging/messaging.dto';
import { PairingStatusValue } from '@kernel/models/db_models.generated.dto';
import type { CurrentUser } from '@kernel/models/user/user.types';
import {
  resolvePairSide,
  canSendToPair,
  counterpartName,
} from './messaging.helpers';

const pair = {
  client_user_id: 'client-1',
  stylist_account_id: 'acc-1',
};

const asUser = (over: Partial<CurrentUser>): CurrentUser =>
  ({
    id: 'x',
    stylist_account: null,
    client_account: null,
    ...over,
  }) as CurrentUser;

describe('resolvePairSide', () => {
  it('returns CLIENT when caller is the pair client', () => {
    const user = asUser({ id: 'client-1' });
    expect(resolvePairSide(pair, user)).toBe(
      StylistClientMessageSenderValue.CLIENT
    );
  });

  it('returns STYLIST when caller owns the pair stylist account', () => {
    const user = asUser({
      id: 'stylist-owner',
      stylist_account: {
        account_id: 'acc-1',
      } as CurrentUser['stylist_account'],
    });
    expect(resolvePairSide(pair, user)).toBe(
      StylistClientMessageSenderValue.STYLIST
    );
  });

  it('returns null for a non-party (foreign user)', () => {
    const user = asUser({
      id: 'intruder',
      stylist_account: {
        account_id: 'acc-999',
      } as CurrentUser['stylist_account'],
    });
    expect(resolvePairSide(pair, user)).toBeNull();
  });

  it('returns null when caller has no stylist account and is not the client', () => {
    expect(resolvePairSide(pair, asUser({ id: 'someone-else' }))).toBeNull();
  });
});

describe('canSendToPair', () => {
  it('allows PENDING and ACTIVE, blocks REVOKED', () => {
    expect(canSendToPair(PairingStatusValue.PENDING)).toBe(true);
    expect(canSendToPair(PairingStatusValue.ACTIVE)).toBe(true);
    expect(canSendToPair(PairingStatusValue.REVOKED)).toBe(false);
  });
});

describe('counterpartName', () => {
  const loaded = {
    clientName: 'Marta',
    clientEmail: 'marta@example.com',
    pairStatus: PairingStatusValue.ACTIVE,
    clientIsActive: true,
    stylistDisplayName: 'Anna Nails',
    stylistBusinessName: 'Studio Anna',
  };
  it('stylist sees the client name', () => {
    expect(
      counterpartName(StylistClientMessageSenderValue.STYLIST, loaded)
    ).toBe('Marta');
  });
  it('stylist falls back to client email for a nameless client (S76)', () => {
    // Prisma defaults User.name to "" (not null). Magic-link signup collects
    // no name, so `.trim() ||` must catch both shapes.
    expect(
      counterpartName(StylistClientMessageSenderValue.STYLIST, {
        ...loaded,
        clientName: '',
      })
    ).toBe('marta@example.com');
    expect(
      counterpartName(StylistClientMessageSenderValue.STYLIST, {
        ...loaded,
        clientName: null,
      })
    ).toBe('marta@example.com');
  });
  it('email fallback is GATED: no email on PENDING pair (PII-minimum pre-accept, S82)', () => {
    expect(
      counterpartName(StylistClientMessageSenderValue.STYLIST, {
        ...loaded,
        clientName: '',
        pairStatus: PairingStatusValue.PENDING,
      })
    ).toBe('');
  });
  it('email fallback is GATED: no email for soft-deleted client (cascade parity, S82)', () => {
    expect(
      counterpartName(StylistClientMessageSenderValue.STYLIST, {
        ...loaded,
        clientName: '',
        clientIsActive: false,
      })
    ).toBe('');
  });
  it('client sees the stylist display name (business fallback), NEVER stylist email', () => {
    expect(
      counterpartName(StylistClientMessageSenderValue.CLIENT, loaded)
    ).toBe('Anna Nails');
    expect(
      counterpartName(StylistClientMessageSenderValue.CLIENT, {
        ...loaded,
        stylistDisplayName: null,
      })
    ).toBe('Studio Anna');
    // PII direction is closed: no names yields '' (the UI shows "Rozmowa"), not an e-mail.
    expect(
      counterpartName(StylistClientMessageSenderValue.CLIENT, {
        ...loaded,
        stylistDisplayName: null,
        stylistBusinessName: null,
      })
    ).toBe('');
  });
});
