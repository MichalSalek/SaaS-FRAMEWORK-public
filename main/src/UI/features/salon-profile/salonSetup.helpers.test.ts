import { describe, expect, it } from 'vitest';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import { getSalonSetupRemaining } from './salonSetup.helpers';
const profile: SalonProfileData = {
  account_id: 'owner',
  name: 'Salon',
  name_configured: true,
  salon_vanity_url: 'salon-test',
  brand_accent_color: '#8C2F45',
  show_team: false,
  owner: {
    account_id: 'owner',
    name: 'Owner',
    avatar_url: null,
    identifier: 'owner',
  },
  members: [],
  works: [
    { gallery_record_id: 'work', asset_url: 'https://example.com/work.jpg' },
  ],
  contact: {
    address_city: 'Kraków',
    website: null,
    instagram_handle: null,
    phone: '+48123456789',
  },
};
describe('saved salon setup progress', () => {
  it('allows a solo owner to complete setup with the team hidden', () => {
    expect(getSalonSetupRemaining(profile)).toEqual([]);
  });
  it('does not mistake a fallback name or city for configured identity and contact', () => {
    expect(
      getSalonSetupRemaining({
        ...profile,
        name_configured: false,
        contact: { ...profile.contact, phone: null },
      })
    ).toEqual(['name', 'contact']);
  });
  it('keeps missing address and empty showcase visible, never the default colour', () => {
    expect(
      getSalonSetupRemaining({
        ...profile,
        salon_vanity_url: null,
        brand_accent_color: null,
        works: [],
      })
    ).toEqual(['address', 'showcase']);
  });
});
