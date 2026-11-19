# Playground interfejsu

[English](README.md) | **Polski**

`/dev/playground` porównuje tymczasowe warianty rzeczywistych tras aplikacji przy
wybranych szerokościach. Korzysta z bieżącej sesji, danych i CSS, aby decyzję
układu sprawdzić w kontekście. Trasa działa tylko w development i staging.

## Działanie wariantów

Rejestr `playground.votes.ts` definiuje pytanie, trasę, szerokości i warianty.
Każdy iframe otwiera trasę z `?pg=<voteId>:<candidateId>`. Komponent odczytuje
parametr przez `usePlaygroundVariant`; poza obsługiwanymi środowiskami hook
zwraca `null`.

Osadzanie w ramach tego samego originu kontrolują polityka playgroundu i nagłówki
odpowiedzi. Większe ramki są wizualnie skalowane, ale zachowują szerokość layoutu.
Przełącznik motywu zmienia atrybuty ramek bez zmiany zapisanej preferencji.
Wybory korzystają z zarejestrowanego klucza storage i można je zebrać jako tekst.

## Dodawanie i zamykanie porównania

1. Opisz zaobserwowany problem i zarejestruj warianty.
2. Dodaj tymczasową gałąź wariantu przy odpowiednim komponencie.
3. Zachowaj dotychczasowe zachowanie trasy bez parametru wariantu.
4. Porównaj właściwe szerokości, języki i stany na reprezentatywnych danych.
5. Wprowadź wybrany wynik, a następnie usuń tymczasowe gałęzie i wpis rejestru.

Playground wspiera decyzję projektową. Nie jest automatycznym testem wizualnym
ani zamiennikiem sprawdzenia wybranego rozwiązania po integracji.

## Od czego zacząć

- [Rejestr wariantów](playground.votes.ts)
- [Komponent ramki](PlaygroundFrame.organism.tsx)
- [Hook wariantu](../../../shared/hooks/usePlaygroundVariant.ts)
