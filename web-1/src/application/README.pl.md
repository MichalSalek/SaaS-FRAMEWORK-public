# Usługi application na backendzie

[English](README.md) | **Polski**

Warstwa implementuje obsługę HTTP i wspólną infrastrukturę operacji domenowych.
Obejmuje uwierzytelnianie, uprawnienia, helpery bazy, płatności, e-mail, logowanie,
walidację środowiska i planowanie zadań konserwacyjnych.

## Główne obszary

| Katalog                     | Odpowiedzialność                                                    |
| --------------------------- | ------------------------------------------------------------------- |
| `http/`                     | Fabryki handlerów, middleware, odpowiedzi i mapowanie błędów        |
| `auth/`, `permissions/`     | Integracja Better Auth i sprawdzanie uprawnień ról                  |
| `db/`                       | Dostęp Prisma, transakcje, blokady i zapisy warunkowe               |
| `errors/`                   | Zamiana błędów bazy i usług na typowane wyniki                      |
| `stripe/`                   | Adapter płatności, webhooki i odzyskiwanie niedokończonych operacji |
| `email-handler/`            | Transport e-mail i adaptery dostawców                               |
| `event-log/`, `debugger/`   | Zdarzenia audytowe i logi diagnostyczne                             |
| `interceptors/`, `runtime/` | Zadania sweep i śledzona praca odroczona                            |
| `environment/`              | Deklaracje i walidacja środowiska                                   |

## Wspólne mechanizmy

`defineHandler` łączy pomiar czasu z pipeline wersjonowanych żądań. Handler nadal
wybiera odpowiedź sukcesu i mapuje niepowodzenie operacji. `withPublicHandler`
i `withRawSecretHandler` obsługują trasy poza tym pipeline.

`withWriteTx` ujednolica ustawienia transakcji zapisujących i wybrane ponowienia.
Callback nie powinien wykonywać zewnętrznych efektów, ponieważ ponowienie uruchomi
go jeszcze raz. Helpery blokad dokumentują ich kolejność, a `cas.ts` udostępnia
aktualizacje warunkowe. Błędy Prisma są rozpoznawane po strukturze zamiast przez
`instanceof`, które może być zawodne przy osobnych instancjach modułu w bundlu.

## Integracje i zadania w tle

Kod korzysta z klientów zewnętrznych przez adaptery. Handlery Stripe zbierają efekty
do wykonania po zatwierdzeniu transakcji. Zadania konserwacyjne używają fabryki
sweep z ograniczaniem częstotliwości i monitoringiem; wykluczanie między instancjami
wymaga dodatkowej koordynacji w bazie. `runAfterResponse` śledzi odroczoną pracę,
aby można było na nią poczekać przy zamykaniu procesu.

Dane produktu i logi aplikacyjne mają osobnych klientów Prisma. Awaria zapisu logu
nie powinna blokować żądania. Walidacja środowiska rozróżnia wartości wymagane
i opcjonalne; ścisłe środowiska zatrzymują start przy nieprawidłowej wymaganej konfiguracji.

## Granice i ograniczenia

Warstwa zależy głównie od kernela i adapterów. Wybrane pliki koordynujące importują
kod domeny w ramach opisanych wyjątków ESLint. Wspólne helpery ograniczają
powtarzanie kodu, ale nadal wymagają testów zachowania i przeglądu granic integracji.

## Od czego zacząć

- [Fabryka handlerów](http/define-handler.ts)
- [Middleware żądań](http/request.middleware.ts)
- [Mapper błędów](http/error-mapper.ts)
- [Transakcje zapisujące](db/with-write-tx.ts)
- [Blokady wierszy](db/lock-rows.ts)
- [Opis API](../../README.pl.md)
