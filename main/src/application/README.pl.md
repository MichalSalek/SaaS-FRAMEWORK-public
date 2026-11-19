# Usługi application na frontendzie

[English](README.md) | **Polski**

Warstwa udostępnia usługi używane przez różne funkcje: transport HTTP, stan
logowania, zdarzenia odpowiedzi, storage, tłumaczenia, nawigację i integrację
z platformą. Dzięki temu ekrany mogą skupiać się na swoich danych i interakcjach.

## Główne obszary

| Katalog                   | Odpowiedzialność                                                |
| ------------------------- | --------------------------------------------------------------- |
| `http/`                   | Fabryki endpointów, klucze zapytań, QueryClient i reguły błędów |
| `event-bus/`              | Przetwarzanie zdarzeń odpowiedzi i wspólne komunikaty           |
| `auth/`                   | Stan sesji, logowanie i natywne deep linki                      |
| `client-device-storage/`  | Adaptery storage, klucze i początkowy motyw                     |
| `stores/`                 | Wspólny stan klienta, w tym przejścia nawigacji                 |
| `platform/`, `lifecycle/` | Adaptery przeglądarki i Capacitor oraz cykl życia               |
| `environment/`            | Deklarowana konfiguracja środowiska frontendu                   |

## Transport i odpowiedzialność za stan

`http/io.ts` zwraca typowane funkcje Promise. Deklaracje domenowe je konfigurują,
a hooki funkcji używają ich z TanStack Query. Hooki odpowiadają za zmiany cache
i cofanie aktualizacji optymistycznych. Wspólne komunikaty obsługuje pipeline
zdarzeń, chyba że ekran jawnie przejmuje tę odpowiedzialność.

Rejestry kluczy zapytań i storage nadają wspólnym danym spójne identyfikatory.
Funkcja korzysta z tych definicji także wtedy, gdy odczytuje lub unieważnia dane
innego obszaru.

## Granice

Warstwa korzysta z kernela i adapterów infrastruktury. Renderowanie i stan
specyficzny dla interfejsu pozostają w `UI/`. Helpery platformy udostępniają
odpowiednik przeglądarkowy albo pomijają działanie, gdy funkcja natywna jest
niedostępna. Konfiguracja środowiska jest wspólna dla wszystkich funkcji.

## Od czego zacząć

- [Fabryki endpointów](http/io.ts)
- [Klucze zapytań](http/queryKeys.factory.ts)
- [Pipeline odpowiedzi](event-bus/eventPipeline.orchestrator.ts)
- [Opis frontendu](../../README.pl.md)
