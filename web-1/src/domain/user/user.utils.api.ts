import { handlePromiseWithTimeout } from '@msalek/utils';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { getCountryAndCity } from '@app/geolocalization/geo.utils';
import type { Session } from '@kernel/models/db_models.generated.dto';
import type { UserMetadata } from '@kernel/models/db_models.manual.dto';
import { narrowUserMetadata } from '@kernel/models/type_narrowing';
import type {
  CurrentUser,
  UserWithRelations,
} from '@kernel/models/user/user.types';
import { salonDisplayName } from '@kernel/domain/salon-profile/salon-names';
import type {
  SafeCurrentUser,
  SafeStylistAccount,
} from '@kernel/models/session/session.dto';

export const makeCurrentUser = ({
  user,
  session,
}: {
  user: UserWithRelations;
  session: Session;
}): CurrentUser => {
  return {
    ...user,
    session,
  };
};

// DECISION: the single sanitizer for every response body returning CurrentUser. It strips `session.token`
// (bearer credential, ~30d persistent: theft = full session) and `session.userId` (redundant with
// currentUser.id). The token persists in the Authorization header (out-of-band) and the DB row. MUST be
// used in EVERY handler that responds with CurrentUser (admin/become-user, admin/switch-back-become-user,
// auth/dev-login, session/get-current). SSOT shape: `SafeCurrentUser` in
// .shared-kernel/models/session/session.dto.ts. Relations loaded by `userRelationsEnabler` that
// `SafeCurrentUser` does not declare are dropped below: a spread passed them into the response body and
// TypeScript missed it, because excess properties are not checked on spread. The UI has its own paginated
// endpoints for those lists.
const RELATIONS_OUTSIDE_CONTRACT = [
  'sessions',
  'favorite_stylists',
  'favorite_records',
] as const;

// DECISION: `stylist_account` goes back to the client as an ALLOWLIST, not a row spread (rationale and
// field list: SafeStylistAccount in session.dto.ts). The map is typed `Record<keyof SafeStylistAccount,
// true>`, so the compiler enforces parity both ways: a field added to the type without an entry here, or
// an entry without a field, fails compilation. The server-side include (`userRelationsEnabler`) stays
// FULL on purpose: handlers read plan, Stripe and counter fields from `currentUser.stylist_account`.
const SAFE_STYLIST_ACCOUNT_FIELDS: Record<
  Exclude<
    keyof SafeStylistAccount,
    | 'billing'
    | 'effective_pricing_plan'
    | 'salon_plan'
    | 'has_salon_profile'
    | 'salon_display_name'
  >,
  true
> = {
  account_id: true,
  display_name: true,
  business_name: true,
  address_street: true,
  address_city: true,
  address_postal_code: true,
  address_country: true,
  phone: true,
  website: true,
  description: true,
  vanity_url: true,
  instagram_handle: true,
  external_links: true,
  avatar_url: true,
  brand_accent_color: true,
  view_count: true,
  pricing_plan: true,
  payment_status: true,
  account_status: true,
  plan_selected_at: true,
  subscription_status: true,
  cancel_at_period_end: true,
  cancel_at: true,
  current_period_end: true,
  trial_started_at: true,
  trial_ends_at: true,
  admin_plan_override: true,
  email_preferences: true,
};

const SAFE_STYLIST_ACCOUNT_KEYS = Object.keys(
  SAFE_STYLIST_ACCOUNT_FIELDS
) as (keyof typeof SAFE_STYLIST_ACCOUNT_FIELDS)[];

const toSafeStylistAccount = (
  account: NonNullable<CurrentUser['stylist_account']>
): SafeStylistAccount => {
  const projected: Partial<Record<keyof SafeStylistAccount, unknown>> = {};
  for (const key of SAFE_STYLIST_ACCOUNT_KEYS) {
    projected[key] = account[key];
  }
  return {
    ...projected,
    effective_pricing_plan: account.effective_pricing_plan,
    salon_plan: account.salon_plan,
    has_salon_profile: Boolean(
      account.salon_profile_name || account.salon_vanity_url
    ),
    salon_display_name: salonDisplayName(account),
  } as SafeStylistAccount;
};

export const toSafeCurrentUser = (
  currentUser: CurrentUser
): SafeCurrentUser => {
  const {
    session: { token: _token, userId: _userId, ...safeSession },
    stylist_account,
    avatar_public_id: _avatarPublicId,
    ...userData
  } = currentUser;

  // A projection, not a bare spread: the sanitizer is the contract BOUNDARY, so it drops everything
  // `SafeCurrentUser` does not promise.
  const projected = { ...userData } as Record<string, unknown>;
  for (const key of RELATIONS_OUTSIDE_CONTRACT) {
    delete projected[key];
  }

  return {
    ...(projected as Omit<CurrentUser, 'session' | 'stylist_account'>),
    stylist_account:
      stylist_account === null ? null : toSafeStylistAccount(stylist_account),
    session: safeSession,
  };
};

export const fillUserMetadataWithLocation = async (
  body: Partial<UserMetadata> | unknown
): Promise<UserMetadata> => {
  const maybeUserMetadata = narrowUserMetadata(
    body,
    'getUserMetadataFromRequest'
  );
  const userMetadata: UserMetadata = {
    user_agent: maybeUserMetadata.user_agent,
    language: maybeUserMetadata.language,
    client_ip: maybeUserMetadata.client_ip,
    location: null,
  };

  try {
    userMetadata.location =
      (await handlePromiseWithTimeout<string | null>(
        getCountryAndCity({ client_ip: maybeUserMetadata.client_ip ?? null })
      )) ?? null;
    return userMetadata;
  } catch (e) {
    reportIssueBackend({
      namespace: 'fillUserMetadataWithLocation',
      message: `error.`,
      payload: e,
      mode: 'error',
    });
    return userMetadata;
  }
};
