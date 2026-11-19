# Panel administracyjny

[English](README.md) | **Polski**

Katalog zawiera ekrany obsługi użytkowników, moderacji, wsparcia, e-maili, logów,
stanu usług, konfiguracji i uprawnień. Punkty wejścia tras są w `src/pages/app/admin/`,
a `AdminPageLayout` zapewnia wspólny layout i nawigację.

## Struktura

Ekrany mają nazwy `Admin<Name>Page.composition.tsx`. Wspólne elementy znajdują się
w `components/`, hooki danych w `hooks/`, a czysta logika filtrowania, eksportu
oraz stanu w plikach modeli z testami obok. Deklaracje API są w `src/domain/admin/`.

## Uprawnienia i edycja

Uprawnienia ról systemowych pochodzą z konfiguracji kernela i nie są edytowalne
w panelu. Zmiany ról własnych zapisuje API, które egzekwuje tę samą zasadę.
Filtrowanie macierzy zmienia widoczne wiersze bez odrzucania całej wersji roboczej.

Edytory śledzą oczekujące zapisy osobno dla rekordu. Filtry w adresie zachowują
widok po odświeżeniu. Eksport i paginacja korzystają z danych bieżącego filtra.
Kontrolki frontendu uzupełniają sprawdzanie uprawnień i własności na backendzie.

## Eksport CSV

`admin-csv.ts` obsługuje cytowanie i komórki przypominające formuły. `users-csv.ts`
pobiera strony według bieżących filtrów i sortowania, z jawnym limitem wierszy.
Definicje kolumn dostarczają wartości eksportu, a daty mają format ISO 8601 w UTC.
Interfejs informuje o skróconym eksporcie.

## Od czego zacząć

- [Ekran użytkowników](AdminUsersPage.composition.tsx)
- [Macierz uprawnień](components/AdminPermissionsMatrix.organism.tsx)
- [Helper CSV](admin-csv.ts)
- [Flagi funkcji](AdminFeatureFlagsPage/README.pl.md)
