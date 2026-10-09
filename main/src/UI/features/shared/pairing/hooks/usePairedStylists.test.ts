import { describe, expect, it } from 'vitest';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';
import { mapPairedStylistViews } from './usePairedStylists';

type PairRow =
  PAIRING_DTO_API_V1['PAIRING_GET_MY_PAIRS']['RESPONSE']['pairs'][number];

const activeStylist = {
  id: 'pair-active',
  account_id: 'acc-active',
  display_name: 'Anna Nowak',
  business_name: 'Studio A',
  address_city: 'Warszawa',
  avatar_url: 'https://example.com/a.jpg',
  paired_at: '2026-01-15T10:00:00.000Z',
  counterpart_inactive: false,
} satisfies PairRow;

const inactiveStylist = {
  id: 'pair-inactive',
  account_id: 'acc-inactive',
  display_name: '',
  business_name: null,
  address_city: null,
  avatar_url: null,
  paired_at: '2026-02-01T12:00:00.000Z',
  counterpart_inactive: true,
} satisfies PairRow;

const clientPair = {
  id: 'pair-client',
  user_id: 'user-1',
  name: '',
  email: '',
  paired_at: '2026-03-01T08:00:00.000Z',
  counterpart_inactive: true,
} satisfies PairRow;

describe('mapPairedStylistViews', () => {
  it('maps counterpart_inactive onto isInactive and keeps the masked name', () => {
    const views = mapPairedStylistViews([activeStylist, inactiveStylist]);

    expect(views).toEqual([
      {
        stylistAccountId: 'acc-active',
        stylistDisplayName: 'Anna Nowak',
        pairedAt: '2026-01-15T10:00:00.000Z',
        isInactive: false,
      },
      {
        stylistAccountId: 'acc-inactive',
        stylistDisplayName: '',
        pairedAt: '2026-02-01T12:00:00.000Z',
        isInactive: true,
      },
    ]);
  });

  it('drops client-shaped pairs so the client dashboard only sees stylists', () => {
    const views = mapPairedStylistViews([clientPair, activeStylist]);

    expect(views).toHaveLength(1);
    expect(views[0]?.stylistAccountId).toBe('acc-active');
    expect(views[0]?.isInactive).toBe(false);
  });
});
