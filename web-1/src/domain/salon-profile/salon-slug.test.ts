import { describe, it, expect } from 'vitest';
import { mockDb } from '../../test-utils/mockApiHandler';
import { checkSalonSlug_IO } from './salon-profile.operations';
import {
  getSalonProfilePath,
  getSalonProfileRedirect,
} from '@kernel/domain/salon-profile/salon.urls';
import { vanityUrlSchema } from '@kernel/domain/user-and-account/vanity-url.config';
describe('salon addresses', () => {
  it('uses the same validator and rejects malformed addresses', () => {
    for (const slug of ['aa', 'Anna', 'anna salon', 'ąnna', 'a'.repeat(51)]) {
      expect(vanityUrlSchema.safeParse(slug).success).toBe(false);
    }
    expect(vanityUrlSchema.safeParse('anna-nails').success).toBe(true);
  });
  it('blocks reserved words without a database read', async () => {
    expect(
      await checkSalonSlug_IO({ accountId: 'owner', slug: 'admin' })
    ).toEqual({ success: true, data: { available: false } });
  });
  it('permits an existing own slug and rejects another salon collision', async () => {
    mockDb({
      stylistAccount: { findFirst: async () => ({ account_id: 'owner' }) },
      profileLinkAlias: { findUnique: async () => null },
    });
    expect(
      await checkSalonSlug_IO({ accountId: 'owner', slug: 'anna-nails' })
    ).toEqual({ success: true, data: { available: true } });
    expect(
      await checkSalonSlug_IO({ accountId: 'other', slug: 'anna-nails' })
    ).toEqual({ success: true, data: { available: false } });
  });
  it('keeps a retired salon link reserved for its owner only', async () => {
    mockDb({
      stylistAccount: { findFirst: async () => null },
      profileLinkAlias: { findUnique: async () => ({ account_id: 'owner' }) },
    });
    expect(
      await checkSalonSlug_IO({ accountId: 'owner', slug: 'old-salon' })
    ).toEqual({ success: true, data: { available: true } });
    expect(
      await checkSalonSlug_IO({ accountId: 'other', slug: 'old-salon' })
    ).toEqual({ success: true, data: { available: false } });
  });
  it('redirects the id route permanently and leaves the slug route alone', () => {
    expect(
      getSalonProfileRedirect(
        { account_id: 'id', salon_vanity_url: 'new-address' },
        false,
        'de'
      )
    ).toEqual({ destination: '/de/s/new-address/', statusCode: 301 });
    expect(
      getSalonProfileRedirect(
        { account_id: 'id', salon_vanity_url: 'new-address' },
        true
      )
    ).toBeNull();
    expect(getSalonProfileRedirect({ account_id: 'id' }, false)).toBeNull();
  });
  it('builds canonical localized slug paths and stable id fallbacks', () => {
    expect(
      getSalonProfilePath({ account_id: 'id', salon_vanity_url: 'anna-nails' })
    ).toBe('/s/anna-nails/');
    expect(
      getSalonProfilePath(
        { account_id: 'id', salon_vanity_url: 'anna-nails' },
        'de'
      )
    ).toBe('/de/s/anna-nails/');
    expect(getSalonProfilePath({ account_id: 'id' }, 'en')).toBe(
      '/en/salon/id/'
    );
  });
});
