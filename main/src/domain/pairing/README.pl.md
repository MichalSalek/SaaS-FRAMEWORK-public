# Parowanie klientki i stylistki

[English](README.md) | **Polski**

Ten obszar deklaruje wywołania API służące do łączenia klientek ze stylistkami,
obsługi próśb i cofania dostępu. Para oznacza relację dostępu, odrębną od logowania
i od tymczasowej sesji QR używanej do jej utworzenia.

## Przebieg

1. Stylistka wyświetla kod QR sesji parowania.
2. Zalogowana klientka otwiera ścieżkę dołączenia i wysyła prośbę.
3. Stylistka akceptuje albo odrzuca prośbę.
4. Aktywna relacja umożliwia operacje dopuszczone przez reguły dostępu API.
5. Właściwe konto lub uprawniony operator może cofnąć dostęp zgodnie z regułami backendu.

## Odpowiedzialność frontendu

`pairingIO.possibilities.api.ts` deklaruje transport z użyciem DTO i tras kernela.
Hooki w `UI/features/shared/pairing/hooks/` obsługują listy, prośby i stan dostępu.
`UI/features/pairing/hooks/useQrScanner.ts` obsługuje kamerę i odczyt kodu QR.

Zmiany cache i komunikaty należą do hooków oraz reguł obsługi odpowiedzi.
Wibracje po potwierdzonych wynikach serwera uruchamia pipeline zdarzeń. API
decyduje o dostępie także wtedy, gdy klient ma jeszcze starszy stan relacji w cache.

## Od czego zacząć

- [Deklaracje API](pairingIO.possibilities.api.ts)
- [Wspólne hooki parowania](../../UI/features/shared/pairing/hooks/)
- [Ekran parowania](../../UI/features/pairing/PairingPage.composition.tsx)
- [Deklaracje domenowe](../README.pl.md)
