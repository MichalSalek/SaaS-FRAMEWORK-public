// UI/shared/format/userDisplayName.formatters.ts
// The name a person sees for themselves in the app chrome (drawer header,
// impersonation banner, account rail, AppBar avatar).
//
// WHY a helper: `User.name` defaults to '' (klasa S67a), so the `??` chains that
// grew at each call site stopped at the empty string and rendered a blank name
// ("Zalogowano jako " with nothing after it, an empty drawer header). Only the
// AppBar avatar used `.trim() ||`; the other three sites drifted.

/** First value that is a non-blank string, trimmed; `undefined` when none is. */
export function firstNonBlank(
  ...values: ReadonlyArray<string | null | undefined>
): string | undefined {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return undefined;
}

/** Slice of `currentUser` the display name is built from. */
export interface DisplayNameSource {
  name?: string | null;
  email?: string | null;
  stylist_account?: { display_name?: string | null } | null;
}

/** Stylist display name → account name → e-mail; `undefined` when all blank. */
export function resolveUserDisplayName(
  user: DisplayNameSource | null | undefined
): string | undefined {
  if (user == null) {
    return undefined;
  }
  return firstNonBlank(
    user.stylist_account?.display_name,
    user.name,
    user.email
  );
}
