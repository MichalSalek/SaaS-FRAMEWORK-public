import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';

export const SALON_SETUP_HREF = `${ROUTES_FRONT.STYLIST_PROFILE_MANAGE}?profile=salon`;
export type SalonSetupItem = 'name' | 'address' | 'contact' | 'showcase';

/** Completion comes only from saved fields, never form drafts or inferred defaults.
 *  The brand colour is not an item: „Domyślny” is a valid choice, not a gap. */
export function getSalonSetupRemaining(
  profile: SalonProfileData
): SalonSetupItem[] {
  const items: [SalonSetupItem, boolean][] = [
    [
      'name',
      'name_configured' in profile
        ? profile.name_configured === true
        : Boolean(profile.name.trim()),
    ],
    ['address', Boolean(profile.salon_vanity_url)],
    [
      'contact',
      [
        profile.contact.phone,
        profile.contact.website,
        profile.contact.instagram_handle,
      ].some(value => Boolean(value?.trim())),
    ],
    ['showcase', profile.works.length > 0],
  ];
  return items.filter(([, complete]) => !complete).map(([item]) => item);
}
