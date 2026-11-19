# Aplikacja webowa

[English](README.md) | **Polski**

`main/` zawiera strony publiczne, aplikację dla stylistek i klientek, funkcje salonu
oraz panel administracyjny. Korzysta z Next.js Pages Router, Reacta, TanStack Query,
Zustand, CSS Modules i next-intl. Ta sama aplikacja webowa może działać w osobnej
powłoce Androida opartej na Capacitor.

## Mapa katalogów

| Ścieżka                       | Odpowiedzialność                                              |
| ----------------------------- | ------------------------------------------------------------- |
| `src/pages/`                  | Punkty wejścia tras i pobieranie danych strony                |
| `src/UI/features/`            | Ekrany, hooki funkcji i lokalne komponenty                    |
| `src/UI/components/`          | Wspólne komponenty z określoną warstwą atomic design          |
| `src/UI/layouts/`             | Layouty stron publicznych, aplikacji i administracji          |
| `src/application/`            | Transport HTTP, stan logowania, zdarzenia i obsługa platformy |
| `src/domain/`                 | Typowane deklaracje API według obszaru biznesowego            |
| `src/READONLY-shared-kernel/` | Zsynchronizowana kopia wspólnego kontraktu                    |
| `src/locales/`                | Polskie, angielskie i niemieckie tłumaczenia interfejsu       |

## Dane i komunikaty

Funkcja deklaruje wywołania backendu w `src/domain/`, korzystając z fabryk
w [`io.ts`](src/application/http/io.ts). Hooki używają tych funkcji z TanStack Query
i odpowiadają za unieważnianie cache oraz aktualizacje optymistyczne. Klucze zapytań
pochodzą z `src/application/http/queryKeys.factory.ts`.

Pipeline zdarzeń odpowiedzi obsługuje wspólne komunikaty. Ekran, który sam
potwierdza sukces lub wyświetla błąd, deklaruje to w opcjach wywołania albo metadanych
mutacji. Ogranicza to podwójne komunikaty bez powielania transportu.

## Layout i dostęp

Pliki stron pobierają dane i uruchamiają kompozycje funkcji. Kompozycja montuje swój
layout, dzięki czemu ładowanie, błąd i pusty stan mają tę samą nawigację. Guardy
klienta przekierowują użytkownika zależnie od sesji i roli; backend kontroluje
dostęp do operacji i konkretnych zasobów.

Wywołania Capacitor są opakowane w `src/application/platform/` i helperach cyklu
życia aplikacji. Komponenty korzystają z tych adapterów zamiast bezpośrednio
z zachowań Androida.

## Od profilu do prośby o połączenie

Klientka otwiera profil stylistki i potwierdza wysłanie prośby o połączenie. Hook profilu obsługuje potwierdzenie i wywołuje mutację. Po udanym zapisie mutacja unieważnia informację o dostępie do tej konkretnej stylistki i odświeża listę oczekujących próśb klientki. Stylistka rozpatruje prośbę w swoim panelu. Oba widoki korzystają z tego samego kontraktu HTTP i osobno zarządzają stanem wyświetlania. [Interakcja na profilu](src/UI/features/stylist/hooks/useProfilePairRequest.ts) / [Zapytania i mutacje](src/UI/features/shared/pairing/hooks/usePairRequests.ts) / [Ekran stylistki](src/UI/features/pairing/StylistPairRequests.organism.tsx)

[Przewodnik po API](../web-1/README.pl.md) prowadzi od decyzji stylistki do zapisu w PostgreSQL. [Główne README](../README.pl.md) łączy obie sesje z regułą biznesową.

## Od czego zacząć

- [Architektura UI](src/UI/UI_ARCHITECTURE.md)
- [Warstwa application](src/application/README.pl.md)
- [Deklaracje domenowe](src/domain/README.pl.md)
- [Warstwy komponentów](src/UI/components/ATOMIC_LAYERS.md)
- [Integracja natywna](src/UI/NATIVE_INTEGRATION_GUIDE.md)
- [Funkcja ulubionych](src/UI/features/favorites/)

Eksport pomija część środowiska i narzędzi potrzebnych do uruchomienia całego systemu.
