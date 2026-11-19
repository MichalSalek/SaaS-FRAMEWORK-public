# Testy przeglądarkowe

[English](README.md) | **Polski**

Playwright sprawdza wybrane ścieżki na środowisku deweloperskim: logowanie,
trwałość sesji, nawigację zależną od roli, wejście w parowanie i strony konta.
Testy smoke API dokładniej obejmują reguły endpointów.

## Wymagania

Zestaw przeglądarkowy wymaga skonfigurowanego środowiska i zależności przeglądarki. Eksport pomija część tej konfiguracji.

## Konfiguracja

Zestaw używa jednego workera, ponieważ scenariusze współdzielą konta i bazę.
Projekty Chromium obejmują desktop oraz wąski viewport telefonu. Konfiguracja
oczekuje działającego środowiska zamiast samodzielnie uruchamiać kontenery.
Ślady, zrzuty i wideo błędów zapisuje według `playwright.config.ts`.

Helpery wprowadzają token bearer do przygotowania sesji, tworzą dane przez API
i sprzątają po scenariuszach. Testy korzystają z selektorów semantycznych, gdy to możliwe.

## Zakres i ograniczenia

Źródłem informacji o pokryciu jest katalog specyfikacji. Wybrane testy sprawdzają
renderowanie strony albo wejście w proces zamiast całej interakcji z dostawcą
zewnętrznym. Upload Cloudinary, zakończone wyzwania płatnicze Stripe i pełne cykle
usuwania kont wymagają dodatkowej weryfikacji. Viewport telefonu nie zastępuje
urządzenia Android.

## Od czego zacząć

- [Konfiguracja](playwright.config.ts)
- [Helper logowania](helpers/auth.ts)
- [Trwałość sesji](specs/16-auth-session-persistence.spec.ts)
