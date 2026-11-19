# Operacje domenowe backendu

[English](README.md) | **Polski**

Każdy katalog reprezentuje obszar produktu, na przykład galerię, parowanie,
ulubione lub wiadomości. Operacje implementują odczyt i zapis, a czyste helpery
opisują lokalne decyzje. Wspólny transport i klienci usług są w `application/`.

## Struktura

```text
domain/<obszar>/
  operations/              odczyt, zapis i wspólne kroki operacji
  <nazwa>.resolver.ts       czysta logika decyzji
  <nazwa>.guards.ts         predykaty i kontrole dostępu
  <obszar>.config.ts        lokalna konfiguracja
  <obszar>.types.ts         lokalne typy
```

Mniejsze obszary mogą mieć pliki bezpośrednio w swoim katalogu. `_shared/guards/`
zawiera wspólne guardy kont. Role plików zależą od potrzeb danego obszaru.

## Wyniki operacji

Operacje zwracające `OperationResult` mają sufiks `_IO`. Oczekiwane niepowodzenia
są deklarowane w uniach błędów kernela, a mapper HTTP przypisuje odpowiedzi
zarejestrowanym wariantom. `databaseFailure()` klasyfikuje wyjątki bazy. Sygnały
wycofania transakcji są przechwytywane we właściwej operacji.

Handler odpowiada za status HTTP i budowę odpowiedzi. Operacja sprawdza regułę
biznesową i dostęp do zasobu, po czym zwraca wynik bez konstruowania odpowiedzi HTTP.

## Dostęp do bazy

Operacje wywołują Prisma bezpośrednio przez `DB_CLIENT`. Dzięki temu zakres
transakcji pozostaje widoczny bez ogólnej warstwy repozytoriów. Wspólne helpery
zapewniają blokady wierszy, aktualizacje warunkowe i wybrane ponowienia. Kontrola
dostępu, która może ścigać się z zapisem, wymaga odpowiedniej transakcji albo bariery
w bazie, a nie tylko wcześniejszego odczytu.

Tożsamość użytkownika i konto stylistki są osobnymi obszarami ze względu na różne
cykle życia. Kernel grupuje część ich kontraktu API pod `user-and-account`.

## Od czego zacząć

- [Operacje ulubionych](favorites/operations/favorite-records.operations.ts)
- [Tworzenie pracy w galerii](gallery/operations/gallery-create.operation.ts)
- [Prośby o parowanie](pairing/operations/pair-request.operations.ts)
- [Guardy kont](_shared/guards/account-guards.ts)
- [Usługi application](../application/README.pl.md)
- [Opis API](../../README.pl.md)
