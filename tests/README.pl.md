# Testy

[English](README.md) | **Polski**

Próbka zawiera testy umieszczone obok kodu aplikacji oraz wybrane zestawy obejmujące obie aplikacje. Ich obecność nie potwierdza, że zostały uruchomione dla tego eksportu.

## Przewodnik po testach

- [Testy operacji próśb o parowanie](../web-1/src/domain/pairing/operations/pair-request.operations.respond.test.ts) obejmują akceptację, odrzucenie i limity.
- [Testy kontraktu parowania](../web-1/src/test-utils/integration/pairing-contract.test.ts) sprawdzają wybrane odpowiedzi API.
- [Testy współbieżności](concurrency/README.pl.md) wysyłają równoległe żądania i sprawdzają stan bazy.
- [Testy przeglądarkowe](e2e/README.pl.md) opisują wybrane ścieżki Playwright.
- [Kontrole strukturalne](audit/README.pl.md) wyjaśniają zawartość katalogu audytów.

## Ograniczenia

Niektóre testy wymagają skonfigurowanego API, PostgreSQL, usług zewnętrznych lub zależności przeglądarki. Eksport pomija kompletne środowisko i narzędzia operacyjne, dlatego służy do czytania, a nie jako gotowe środowisko testowe. Testy obejmują określone scenariusze, a nie każdą możliwą kolejność wykonania czy wynik integracji.
