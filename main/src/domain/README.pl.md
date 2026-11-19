# Deklaracje domenowe frontendu

[English](README.md) | **Polski**

Katalog grupuje typowane wywołania API według obszaru biznesowego. Łączy wspólny
kontrakt z fabrykami transportu w `application/http/io.ts`. Nie implementuje operacji
biznesowych backendu.

## Struktura

Katalogi takie jak `favorites/`, `gallery/` i `pairing/` zawierają funkcje endpointów
korzystające ze wspólnych typów żądań i odpowiedzi. Hooki i ekrany importują te
funkcje zamiast samodzielnie składać adresy oraz opcje HTTP.

```text
wspólne DTO i trasa
  -> deklaracja endpointu w domain
  -> hook zapytania lub mutacji
  -> ekran
```

## Odpowiedzialności

Deklaracja wybiera trasę, metodę i typy kontraktu. Transport obsługuje żądanie
oraz format odpowiedzi. Hooki funkcji odpowiadają za ładowanie, unieważnianie cache,
aktualizacje optymistyczne i wybór lokalnych komunikatów.

Ten podział uwidacznia zmianę kontraktu w deklaracji i miejscach jej użycia,
a zachowanie zapytań pozostawia przy funkcji. Uploady i wybrane ścieżki logowania
mają opisane wyjątki transportowe w `io.ts`.

## Od czego zacząć

- [Deklaracje ulubionych](favorites/favoriteIO.possibilities.api.ts)
- [Parowanie](pairing/README.pl.md)
- [Fabryki transportu](../application/http/io.ts)
- [Opis frontendu](../../README.pl.md)
