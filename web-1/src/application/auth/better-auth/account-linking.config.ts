// web-1/src/application/auth/better-auth/account-linking.config.ts
//
// Zasady podpinania kont z zewnętrznych dostawców do kont już istniejących.
// Wydzielone z better-auth.config.ts, żeby uzasadnienie stało obok samej reguły
// (i żeby główna konfiguracja nie puchła ponad limit długości pliku).

/**
 * DECISION (nie usuwaj tego komentarza):
 * `trustedProviders` zostaje PUSTE. Lista bywa kuszącym lekiem na
 * `account_not_linked`, ale leczy nie tę przyczynę — a wyłącza realną ochronę.
 *
 * Bramka podpinania w Better Auth (zweryfikowane w zainstalowanym 1.6.25,
 * `dist/oauth2/link-account.mjs`) odrzuca podpięcie, gdy zachodzi KTÓRYKOLWIEK
 * z warunków — a są to DWA NIEZALEŻNE warunki i mylenie ich kosztowało już
 * jedną błędną naprawę:
 *   A) `!isTrustedProvider && !userInfo.emailVerified`
 *      — czyli dostawca twierdzi, że NIE zweryfikował adresu.
 *        To jedyny warunek, który `trustedProviders` wyłącza.
 *   B) `requireLocalEmailVerified && !dbUser.user.emailVerified`
 *      — czyli LOKALNE konto ma niezweryfikowany adres. Na tę listę odporny.
 *
 * Incydent 2026-08-17 (produkcja): logowanie Google w natywnej aplikacji
 * kończyło się `account_not_linked` dla konta założonego magic-linkiem.
 * Zadziałała klauzula B: starsza wersja biblioteki nie stemplowała
 * `email_verified`, więc konto z historią logowań miało `false`. Klauzula A
 * zadziałać nie mogła — Google dla zwykłego konta Gmail zwraca
 * `email_verified: true`. Naprawą jest więc stempel weryfikacji w seedach oraz
 * jednorazowy backfill `web-1/scripts/backfill-legacy-email-verified.ts` — i to
 * on incydent zamyka. (`requireLocalEmailVerified: false` byłoby obejściem
 * klauzuli B, ale opcja jest przestarzała i zniknie, więc naprawa oparta na
 * niej odnowiłaby błąd przy najbliższej aktualizacji.)
 *
 * Dlaczego lista MUSI zostać pusta: wpisanie tu `google` wyłącza klauzulę A,
 * czyli każe ufać identyczności, której sam dostawca nie potwierdził. Konta
 * Google Workspace / Cloud Identity na NIEZWERYFIKOWANEJ domenie emitują
 * dokładnie `email_verified: false` dla dowolnego adresu w tej domenie — to
 * kanoniczna ścieżka przejęcia konta przez „Zaloguj się z Google". Ktoś taki
 * dostawałby sesję na istniejącym koncie ofiary (które po backfillu przechodzi
 * klauzulę B). Zysk zerowy, bo incydentu to nie dotyczyło.
 *
 * Konsekwencja do zaakceptowania: tożsamość z `email_verified: false` NIE
 * podepnie się do istniejącego konta i zobaczy `account_not_linked`. To jest
 * zachowanie POPRAWNE, nie regresja incydentu.
 *
 * Funkcja nie przyjmuje już `appleEnabled`: lista bywała warunkowana obecnością
 * konfiguracji APPLE_*, ale pusta lista jest taka sama dla każdego dostawcy.
 */
export const buildAccountLinkingOptions = (): {
  accountLinking: { enabled: true; trustedProviders: string[] };
} => ({
  accountLinking: {
    enabled: true,
    trustedProviders: [],
  },
});
