# Testy współbieżności

[English](README.md) | **Polski**

Zestaw wysyła równoległe żądania do deweloperskiego API i sprawdza wynikowy stan
PostgreSQL. Obejmuje wybrane wyścigi dotyczące liczników, tworzenia relacji,
moderacji, zmian planów i obsługi błędów bazy.

## Wymagania

Testy wymagają skonfigurowanego API i osobnego środowiska PostgreSQL. Eksport pomija część konfiguracji i służy do przeglądania kodu.

## Struktura

`run-concurrency.ts` rejestruje zestawy i koordynuje sprzątanie. `_harness.ts`
uruchamia scenariusze kolejno, ale każdy scenariusz wysyła własną serię równoległych
żądań. `_fixtures.ts` oznacza dane identyfikatorem przebiegu. Wspólne narzędzia API
i bazy zapewniają bariery startu, odczyt oraz sprzątanie.

## Przykłady i ograniczenia

- [Usuwanie pracy i moderacja](gallery-delete-moderation.concurrency.ts)
- [Integracja blokady advisory z Prisma](advisory-xact-lock.concurrency.ts)
- [Helpery równoległych żądań](../utils/api-client.ts)

Asercje obejmują opisane wyścigi i stan bazy. Nie dowodzą pokrycia wszystkich
możliwych kolejności wykonania ani konfliktów bazodanowych.
