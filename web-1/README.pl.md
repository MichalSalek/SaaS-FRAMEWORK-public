# API HTTP

[English](README.md) | **Polski**

`web-1/` implementuje backend jako aplikację API w Next.js. Obsługuje konta,
portfolio, parowanie, wiadomości, salony i administrację. Prisma zapewnia dostęp
do PostgreSQL, Better Auth obsługuje uwierzytelnianie, a Stripe abonamenty.

## Mapa katalogów

| Ścieżka                       | Odpowiedzialność                                         |
| ----------------------------- | -------------------------------------------------------- |
| `src/pages/api/v1/`           | Handlery wersjonowanych endpointów                       |
| `src/pages/api/auth/`         | Trasy uwierzytelniania i wymiany kodu na token           |
| `src/domain/`                 | Operacje biznesowe według obszaru produktu               |
| `src/application/`            | Pipeline żądań, helpery bazy i integracje                |
| `src/prisma/`                 | Schemat bazy produktu i migracje                         |
| `src/prisma-app-logs/`        | Schemat bazy logów aplikacyjnych                         |
| `src/READONLY-shared-kernel/` | Zsynchronizowany wspólny kontrakt                        |
| `src/test-utils/`             | Konfiguracja testów, dane i testy integracyjne handlerów |

## Przepływ żądania

`defineEndpoint` wiąże kontrakt ze wspólną obsługą żądania i operacją
biznesową. Middleware sprawdza transport, uwierzytelnianie, uprawnienia, stan konta
i dane wejściowe. Operacja zwraca dane albo typowane niepowodzenie, a handler
wybiera odpowiedź i zdarzenie.

Właściwa operacja sprawdza dostęp do zasobu. Uprawnienie do trasy samo w sobie nie
oznacza dostępu do konkretnego rekordu. Webhooki i trasy wewnętrzne korzystają
z wrapperów publicznych lub opartych na sekrecie, dostosowanych do transportu.

## Spójność danych

Operacje wywołują Prisma przez `DB_CLIENT`. Wspólne helpery określają ustawienia
transakcji, ponowienia wybranych konfliktów, blokady wierszy i aktualizacje warunkowe.
Ograniczenia bazy wspierają niezmienniki wymagane przy równoległych żądaniach.

Obsługa webhooka Stripe rezerwuje zdarzenie przed zastosowaniem zmiany. Kontekst
zewnętrzny jest pobierany przed transakcją, a zebrane efekty wykonywane po jej
zatwierdzeniu. Zadania sweep odpowiadają za konserwację i wznawianie niedokończonej pracy.

## Błędy i integracje

`OperationResult<T, E>` opisuje oczekiwane wyniki. Mapper błędów HTTP obejmuje
zarejestrowane warianty błędów domenowych. Nieoczekiwane błędy bazy i usług
zewnętrznych są klasyfikowane przez helpery warstwy application.

Adaptery opakowują klientów usług zewnętrznych. Zmienne środowiskowe są deklarowane
i walidowane centralnie; kod domenowy nie odczytuje dowolnych wartości `process.env`.

## Co się dzieje po przyjęciu prośby

Decyzja stylistki trafia do [endpointu powiązanego z kontraktem](src/pages/api/v1/pairing/respond-request/index.ts). Handler pobiera konto stylistki z sesji i przekazuje je do [operacji połączenia](src/domain/pairing/operations/pair-request.operations.ts). Operacja ustala, do kogo należy oczekująca prośba i czy oba konta mają wolne miejsce. Akceptację zapisuje w bazie pod warunkiem, że relacja nadal oczekuje na decyzję. [Testy operacji](src/domain/pairing/operations/pair-request.operations.respond.test.ts) sprawdzają te reguły tam, gdzie system egzekwuje limity.

[Przewodnik po aplikacji webowej](../main/README.pl.md) pokazuje perspektywę obu użytkowniczek. [Główne README](../README.pl.md) łączy obie strony żądania.

## Od czego zacząć

- [Usługi application](src/application/README.pl.md)
- [Operacje domenowe](src/domain/README.pl.md)
- [Fabryka endpointów powiązanych z kontraktem](src/application/http/define-endpoint.ts)
- [Middleware żądań](src/application/http/request.middleware.ts)
- [Operacje ulubionych](src/domain/favorites/operations/favorite-records.operations.ts)
- [Testy backendu](../tests/BACKEND_TESTING.md)

Eksport pomija część środowiska i narzędzi potrzebnych do uruchomienia całego systemu.
