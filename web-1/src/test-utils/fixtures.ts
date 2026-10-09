/**
 * Typed test fixtures built from real kernel/domain types — zero `any`.
 *
 * These produce minimally-complete, structurally-valid domain objects for handler
 * and policy tests. Every field is typed against the generated DTO / kernel models,
 * so a schema change that breaks a fixture surfaces at `tsc` time (the fixtures are
 * a compile-time canary for the auth/account shape).
 *
 * Override any field via the `overrides` parameter (shallow merge) to drive a
 * specific scenario (e.g. a FREE-plan account, a soft-deleted user, a client).
 */

import type {
  Session,
  StylistAccount,
  ClientAccount,
  User,
} from '@kernel/models/db_models.generated.dto';
import {
  AccountTypeValue,
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';
import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import type {
  CurrentUser,
  UserWithRelations,
} from '@kernel/models/user/user.types';
import type { GetCurrentUserOutput } from '@domain/user/user.types';

const FIXED_DATE = new Date('2026-01-01T00:00:00.000Z');

// ─── Session ────────────────────────────────────────────────────────────────────

export const makeSession = (overrides: Partial<Session> = {}): Session => ({
  id: 'sess_test_0000000000000001',
  token: 'tok_test_0000000000000001',
  userId: 'usr_test_0000000000000001',
  expires: new Date(FIXED_DATE.getTime() + 1000 * 60 * 60 * 24 * 30),
  ip_address: null,
  user_agent: null,
  device_type: null,
  createdAt: FIXED_DATE,
  updatedAt: FIXED_DATE,
  ...overrides,
});

// ─── User (core, no relations) ───────────────────────────────────────────────────

export const makeUser = (overrides: Partial<User> = {}): User => ({
  id: 'usr_test_0000000000000001',
  email: 'stylist@test.local',
  emailVerified: true,
  image: null,
  name: 'Test Stylist',
  role_id: SystemRoleId.STYLIST_ROLE,
  createdAt: FIXED_DATE,
  updatedAt: FIXED_DATE,
  is_active: true,
  disabled_at: null,
  deleted_at: null,
  recovery_available: false,
  account_type: AccountTypeValue.STYLIST,
  notifications_enabled: true,
  terms_accepted_at: null,
  moderation_strikes: 0,
  delete_confirm_version: 0,
  ...overrides,
});

// ─── Accounts ─────────────────────────────────────────────────────────────────────

export const makeStylistAccount = (
  overrides: Partial<StylistAccount> = {}
): StylistAccount => ({
  account_id: 'acc_test_0000000000000001',
  created_by_user_id: 'usr_test_0000000000000001',
  display_name: 'Test Salon',
  pricing_plan: PricingPlanValue.PRO,
  payment_status: PaymentStatusValue.PAID,
  account_status: AccountStatusValue.ACTIVE,
  paid_staff_seats: 0,
  account_expiration_date: null,
  upcoming_payment_date: null,
  business_name: null,
  address_street: null,
  address_city: null,
  address_postal_code: null,
  address_country: null,
  latitude: null,
  longitude: null,
  phone: null,
  website: null,
  description: null,
  dashboard_note: null,
  vanity_url: null,
  instagram_handle: null,
  avatar_url: null,
  avatar_public_id: null,
  brand_accent_color: null,
  stripe_customer_id: null,
  subscription_id: null,
  subscription_status: null,
  cancel_at_period_end: null,
  cancel_at: null,
  current_period_end: null,
  last_stripe_event_at: null,
  trial_started_at: null,
  trial_ends_at: null,
  trial_reminder_sent: null,
  plan_selected_at: null,
  email_preferences: DEFAULT_EMAIL_PREFERENCES,
  email_marketing: false,
  email_trial_sequence: true,
  admin_plan_override: false,
  gallery_strength_dismissed_at: null,
  view_count: 0,
  cached_bookmark_count: 0,
  cached_gallery_count: 0,
  cached_likes_count: 0,
  created_at: FIXED_DATE,
  ...overrides,
});

export const makeClientAccount = (
  overrides: Partial<ClientAccount> = {}
): ClientAccount => ({
  client_account_id: 'cli_test_0000000000000001',
  created_by_user_id: 'usr_test_0000000000000002',
  contact_phone: null,
  contact_email: null,
  dashboard_note: null,
  created_at: FIXED_DATE,
  ...overrides,
});

// ─── CurrentUser (UserWithRelations + session) ──────────────────────────────────

/**
 * A logged-in STYLIST: user + stylist_account + session, no client_account.
 * `userOverrides` patch the core user; pass a custom account/session via the nested
 * keys if a scenario needs it.
 */
export const makeStylistCurrentUser = (
  opts: {
    user?: Partial<User>;
    account?: Partial<StylistAccount>;
    session?: Partial<Session>;
  } = {}
): CurrentUser => {
  const user = makeUser(opts.user);
  const stylist_account = makeStylistAccount({
    created_by_user_id: user.id,
    ...opts.account,
  });
  const session = makeSession({ userId: user.id, ...opts.session });
  const withRelations: UserWithRelations = {
    ...user,
    stylist_account,
    client_account: null,
  };
  return { ...withRelations, session };
};

/**
 * A logged-in CLIENT: user (account_type CLIENT, role CLIENT) + client_account +
 * session, no stylist_account.
 */
export const makeClientCurrentUser = (
  opts: {
    user?: Partial<User>;
    account?: Partial<ClientAccount>;
    session?: Partial<Session>;
  } = {}
): CurrentUser => {
  const user = makeUser({
    id: 'usr_test_0000000000000002',
    email: 'client@test.local',
    name: 'Test Client',
    role_id: SystemRoleId.CLIENT_ROLE,
    account_type: AccountTypeValue.CLIENT,
    ...opts.user,
  });
  const client_account = makeClientAccount({
    created_by_user_id: user.id,
    ...opts.account,
  });
  const session = makeSession({ userId: user.id, ...opts.session });
  const withRelations: UserWithRelations = {
    ...user,
    stylist_account: null,
    client_account,
  };
  return { ...withRelations, session };
};

// ─── GetCurrentUserOutput (what getCurrentUser_IO resolves to) ───────────────────

/**
 * Wrap a CurrentUser into the exact `GetCurrentUserOutput` shape the auth chokepoint
 * returns. Feed this to `__setCurrentUser(...)` in setup.ts.
 */
export const makeCurrentUserOutput = (
  currentUser: CurrentUser
): GetCurrentUserOutput => {
  // CurrentUser = UserWithRelations & { session }. Destructure the session off to
  // recover the exact UserWithRelations shape for the `user` slot — no cast.
  const { session, ...userWithRelations } = currentUser;
  return {
    user: userWithRelations,
    currentUser,
    session,
  };
};
