// web-1/src/application/auth/better-auth/account-linking.config.ts
//
// Rules for linking external-provider accounts to existing accounts. Split out of
// better-auth.config.ts so the rationale sits next to the rule (and the main config stays under
// the file length limit).

/**
 * DECISION: `trustedProviders` stays EMPTY. It is a tempting cure for `account_not_linked`, but it
 * treats a different cause and switches off a real protection.
 *
 * Better Auth's link gate (`dist/oauth2/link-account.mjs`) rejects linking when EITHER holds:
 *   A) `!isTrustedProvider && !userInfo.emailVerified`: the provider did NOT verify the address.
 *      Only this condition is disabled by `trustedProviders`.
 *   B) `requireLocalEmailVerified && !dbUser.user.emailVerified`: the LOCAL account is unverified.
 * The observed `account_not_linked` (Google login on a magic-link account) was clause B; the fix is
 * the verification stamp in the seeds plus `web-1/scripts/backfill-legacy-email-verified.ts`.
 *
 * Adding `google` would disable clause A, i.e. trust an identity the provider did not confirm:
 * Workspace accounts on an UNVERIFIED domain emit `email_verified: false`, the canonical
 * account-takeover path. Such an identity must NOT link; the list is identical for every provider.
 */
export const buildAccountLinkingOptions = (): {
  accountLinking: { enabled: true; trustedProviders: string[] };
} => ({
  accountLinking: {
    enabled: true,
    trustedProviders: [],
  },
});
