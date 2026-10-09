/**
 * `toSafeCurrentUser` — granica kontraktu dla każdej odpowiedzi wracającej CurrentUser.
 *
 * KLASA BŁĘDU, którą ta suita pinuje (znaleziona 2026-08-20): sanitizer strippował
 * `token` wyłącznie z POJEDYNCZEJ `session`, a resztę obiektu przepuszczał spreadem.
 * Zapytanie doładowuje jednak `userRelationsEnabler`, czyli m.in. TABLICĘ `sessions`
 * z pełnymi wierszami — więc `become-user` i `switch-back-become-user` oddawały
 * w treści odpowiedzi surowe bearery (do 100 sesji admina naraz). Potwierdzone
 * w runtime: token wyjęty z `data.sessions[0].token` uwierzytelniał się normalnie.
 *
 * TypeScript tego nie łapał: `sessions` / `favorite_stylists` / `favorite_records`
 * nie są zadeklarowane w `SafeCurrentUser`, a sprawdzanie pól nadmiarowych nie
 * dotyczy spreadu — kontrakt „compile-time" mijał się więc z tym, co leciało po HTTP.
 * Dlatego test asercjonuje na KSZTAŁCIE odpowiedzi, nie na typie.
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
    // Relacje doładowane przez userRelationsEnabler — spoza kontraktu SafeCurrentUser.
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

    // Asercja na całej serializacji, nie na wybranych polach: dokładnie ta ścieżka
    // (tablica obok pojedynczej sesji) wymknęła się punktowemu sprawdzeniu.
    expect(JSON.stringify(safe)).not.toContain('BEARER');
    expect(JSON.stringify(safe)).not.toContain('token');
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
    expect(safe.stylist_account).toEqual({ account_id: 'acc_1' });
    expect(safe.session.id).toBe('ses_current');
    // userId jest redundantny wobec currentUser.id i też schodzi (SafeSession).
    expect(safe.session).not.toHaveProperty('userId');
  });
});

/**
 * 2026-09-25: `stylist_account` wracał do klienta CAŁYM wierszem (get-current robił
 * własny destructure bez projekcji). Suita pinuje, że pola wewnętrzne — billing,
 * identyfikatory w chmurze, liczniki, kolumny zgód — nie opuszczają serwera, a pola
 * czytane przez front zostają.
 */
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
