import { describe, it, expect } from 'vitest';
import { buildAccountLinkingOptions } from './account-linking.config';

describe('buildAccountLinkingOptions', () => {
  it('trzyma PUSTĄ listę zaufanych dostawców', () => {
    // Wpis na tej liście wyłącza w Better Auth klauzulę
    // `!isTrustedProvider && !userInfo.emailVerified`, czyli każe ufać
    // identyczności, której sam dostawca nie potwierdził. Konta Workspace na
    // niezweryfikowanej domenie emitują dokładnie `email_verified: false` —
    // to kanoniczna ścieżka przejęcia konta przez „Zaloguj się z Google".
    const options = buildAccountLinkingOptions();
    expect(options.accountLinking.trustedProviders).toEqual([]);
  });

  it('podpinanie kont zostaje WŁĄCZONE — pusta lista go nie wyłącza', () => {
    // Incydent 2026-08-17 (`account_not_linked`) wynikał z drugiej, niezależnej
    // klauzuli: `requireLocalEmailVerified && !dbUser.user.emailVerified`, czyli
    // z LOKALNEGO `email_verified=false` na kontach sprzed stemplowania przez
    // bibliotekę. Zamyka go backfill danych, nie lista zaufanych dostawców.
    expect(buildAccountLinkingOptions().accountLinking.enabled).toBe(true);
  });
});
