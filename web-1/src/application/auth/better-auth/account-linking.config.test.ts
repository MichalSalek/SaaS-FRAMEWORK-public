import { describe, it, expect } from 'vitest';
import { buildAccountLinkingOptions } from './account-linking.config';

describe('buildAccountLinkingOptions', () => {
  it('trzyma PUSTĄ listę zaufanych dostawców', () => {
    // An entry on this list disables Better Auth's clause
    // `!isTrustedProvider && !userInfo.emailVerified`, i.e. trusts an identity
    // the provider itself did not confirm. Workspace accounts on an unverified
    // domain emit exactly `email_verified: false`: the canonical account-takeover
    // path via "Sign in with Google".
    const options = buildAccountLinkingOptions();
    expect(options.accountLinking.trustedProviders).toEqual([]);
  });

  it('podpinanie kont zostaje WŁĄCZONE — pusta lista go nie wyłącza', () => {
    // The `account_not_linked` failure came from the second, independent
    // clause: `requireLocalEmailVerified && !dbUser.user.emailVerified`, a LOCAL
    // `email_verified=false` on accounts predating the library's stamping. A
    // data backfill closes it, not the trusted-provider list.
    expect(buildAccountLinkingOptions().accountLinking.enabled).toBe(true);
  });
});
