/**
 * `toSafeCurrentUser` is the contract boundary for every response that returns CurrentUser.
 *
 * Pinned error class: the sanitizer stripped `token` only from the SINGLE `session` and passed the rest
 * through a spread. The query also loads `userRelationsEnabler`, including the full `sessions` ARRAY,
 * so `become-user` and `switch-back-become-user` returned raw bearers (up to 100 admin sessions).
 *
 * TypeScript did not catch it: `sessions` / `favorite_stylists` / `favorite_records` are not declared in
 * `SafeCurrentUser`, and excess-property checks do not apply to a spread. So the test asserts on the
 * response SHAPE, not on the type.
 */

import { describe, it, expect } from 'vitest';
import { toSafeCurrentUser } from './user.utils.api';
import type { CurrentUser } from '@kernel/models/user/user.types';
import { makeStylistAccount } from '../../test-utils/fixtures';

const buildCurrentUser = (): CurrentUser =>
  ({
    id: 'usr_1',
    email: 'stylist@example.com',
    name: 'Ola',
    account_type: 'STYLIST',
    is_active: true,
    stylist_account: { account_id: 'acc_1' },
    client_account: null,
    session: {
      id: 'ses_current',
      token: 'BEARER-BIEZACEJ-SESJI',
      userId: 'usr_1',
      expires: new Date('2026-12-01T00:00:00.000Z'),
    },
    // Relations loaded by userRelationsEnabler, outside the SafeCurrentUser contract.
    sessions: [
      { id: 'ses_1', token: 'BEARER-INNEGO-URZADZENIA', userId: 'usr_1' },
      { id: 'ses_2', token: 'BEARER-JESZCZE-INNEGO', userId: 'usr_1' },
    ],
    favorite_stylists: [{ id: 'fav_1' }],
    favorite_records: [{ id: 'rec_1' }],
  }) as unknown as CurrentUser;

describe('toSafeCurrentUser', () => {
  it('nie przepuszcza ŻADNEGO tokenu do treści odpowiedzi', () => {
    const safe = toSafeCurrentUser(buildCurrentUser());

    // Assert on the whole serialization, not selected fields: exactly this path (an array next to the
    // single session) slipped past a point check.
    expect(JSON.stringify(safe)).not.toContain('BEARER');
    expect(JSON.stringify(safe)).not.toContain('token');
  });

  it('preserves a salon entry marker after the owner downgrades without leaking saved salon fields', () => {
    const user = buildCurrentUser();
    user.stylist_account = makeStylistAccount({
      pricing_plan: 'FREE',
      salon_profile_name: 'Saved Salon',
      salon_vanity_url: 'saved-salon',
    });
    const safe = toSafeCurrentUser(user);
    expect(safe.stylist_account?.has_salon_profile).toBe(true);
    expect(safe.stylist_account).not.toHaveProperty('salon_profile_name');
    expect(safe.stylist_account).not.toHaveProperty('salon_vanity_url');
  });

  it('names the salon the way her clients read it (salonDisplayName order)', () => {
    const nameOf = (fields: {
      salon_profile_name: string | null;
      business_name: string | null;
      display_name: string | null;
    }) => {
      const user = buildCurrentUser();
      user.stylist_account = makeStylistAccount(fields);
      return toSafeCurrentUser(user).stylist_account?.salon_display_name;
    };
    expect(
      nameOf({
        salon_profile_name: 'Salon Róża',
        business_name: 'Ola Nails',
        display_name: 'Ola',
      })
    ).toBe('Salon Róża');
    expect(
      nameOf({
        salon_profile_name: '',
        business_name: 'Ola Nails',
        display_name: 'Ola',
      })
    ).toBe('Ola Nails');
    expect(
      nameOf({
        salon_profile_name: null,
        business_name: null,
        display_name: 'Ola',
      })
    ).toBe('Ola');
  });
  it('usuwa relacje spoza kontraktu SafeCurrentUser', () => {
    const safe = toSafeCurrentUser(buildCurrentUser()) as Record<
      string,
      unknown
    >;

    expect(safe).not.toHaveProperty('sessions');
    expect(safe).not.toHaveProperty('favorite_stylists');
    expect(safe).not.toHaveProperty('favorite_records');
  });

  it('zachowuje to, co kontrakt OBIECUJE — sanitizer nie może okroić odpowiedzi za bardzo', () => {
    const safe = toSafeCurrentUser(buildCurrentUser());

    expect(safe.id).toBe('usr_1');
    expect(safe.email).toBe('stylist@example.com');
    expect(safe.stylist_account).toEqual({
      account_id: 'acc_1',
      has_salon_profile: false,
      salon_display_name: '',
    });
    expect(safe.session.id).toBe('ses_current');
    // userId is redundant with currentUser.id and is also dropped (SafeSession).
    expect(safe.session).not.toHaveProperty('userId');
  });
});

/**
 * `stylist_account` used to be returned to the client as a whole row (get-current destructured it
 * without a projection). The suite pins that internal fields (billing, cloud ids, counters, consent
 * columns) never leave the server, while the fields the front reads stay.
 */
describe('toSafeCurrentUser — personal photo privacy', () => {
  it('keeps the photo URL but never returns its internal public id', () => {
    const safe = toSafeCurrentUser({
      ...buildCurrentUser(),
      avatar_url: 'https://example.com/photo',
      avatar_public_id: 'private-id',
    });
    expect(safe.avatar_url).toBe('https://example.com/photo');
    expect(safe).not.toHaveProperty('avatar_public_id');
  });
});

describe('toSafeCurrentUser — allowlista stylist_account', () => {
  const INTERNAL_FIELDS = [
    'stripe_customer_id',
    'subscription_id',
    'avatar_public_id',
    'last_stripe_event_at',
    'trial_reminder_sent',
    'dashboard_note',
    'latitude',
    'longitude',
    'email_marketing',
    'email_trial_sequence',
    'gallery_strength_dismissed_at',
    'paid_staff_seats',
    'account_expiration_date',
    'upcoming_payment_date',
    'created_by_user_id',
    'cached_bookmark_count',
    'cached_gallery_count',
    'cached_likes_count',
  ] as const;

  const buildWithFullAccount = (): CurrentUser =>
    ({
      ...buildCurrentUser(),
      stylist_account: makeStylistAccount({
        account_id: 'acc_full',
        display_name: 'Studio Ola',
        stripe_customer_id: 'cus_SEKRET',
        subscription_id: 'sub_SEKRET',
        avatar_public_id: 'nailfolio/avatar_SEKRET',
        dashboard_note: 'notatka prywatna',
        latitude: 52.1,
        longitude: 21.0,
        cached_gallery_count: 42,
        // The Prisma Json column is typed as an object; the wire schema narrows it to string[].
        external_links: ['https://booksy.com/x'] as unknown as Record<
          string,
          unknown
        >,
        admin_plan_override: true,
      }),
    }) as unknown as CurrentUser;

  it('nie oddaje pól wewnętrznych StylistAccount', () => {
    const safe = toSafeCurrentUser(buildWithFullAccount());
    const account = safe.stylist_account as Record<string, unknown> | null;

    expect(account).not.toBeNull();
    for (const field of INTERNAL_FIELDS) {
      expect(account).not.toHaveProperty(field);
    }
    const wire = JSON.stringify(safe);
    expect(wire).not.toContain('SEKRET');
    expect(wire).not.toContain('notatka prywatna');
  });

  it('zostawia pola, które front czyta z bieżącego użytkownika', () => {
    const safe = toSafeCurrentUser(buildWithFullAccount());

    expect(safe.stylist_account).toMatchObject({
      account_id: 'acc_full',
      display_name: 'Studio Ola',
      pricing_plan: expect.any(String),
      payment_status: expect.any(String),
      account_status: expect.any(String),
      admin_plan_override: true,
      // The Prisma Json column is typed as an object; the wire schema narrows it to string[].
      external_links: ['https://booksy.com/x'] as unknown as Record<
        string,
        unknown
      >,
    });
    expect(safe.stylist_account).toHaveProperty('email_preferences');
    expect(safe.stylist_account).toHaveProperty('trial_ends_at');
  });

  it('konto bez roli stylistki zostaje null', () => {
    const safe = toSafeCurrentUser({
      ...buildCurrentUser(),
      stylist_account: null,
    } as unknown as CurrentUser);
    expect(safe.stylist_account).toBeNull();
  });
});
