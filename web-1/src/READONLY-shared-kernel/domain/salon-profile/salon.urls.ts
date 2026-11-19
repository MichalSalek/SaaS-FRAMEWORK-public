/** Separate /s and /u route namespaces make identical salon/stylist slugs harmless. */
export function getSalonProfilePath(
  profile: { account_id: string; salon_vanity_url?: string | null },
  locale = 'pl'
): string {
  const prefix = locale === 'pl' ? '' : `/${locale}`;
  return `${prefix}${profile.salon_vanity_url ? '/s/' + encodeURIComponent(profile.salon_vanity_url) : '/salon/' + encodeURIComponent(profile.account_id)}/`;
}

/** The id route redirects to the custom slug here; a former custom slug redirects through its alias (profile-link-redirect.ts, SCHEMA_DECISIONS.md#profile-link-alias). */
export function getSalonProfileRedirect(
  profile: { account_id: string; salon_vanity_url?: string | null },
  slugRoute: boolean,
  locale = 'pl'
): { destination: string; statusCode: 301 } | null {
  return !slugRoute && profile.salon_vanity_url
    ? { destination: getSalonProfilePath(profile, locale), statusCode: 301 }
    : null;
}
