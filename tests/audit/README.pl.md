# Kontrole strukturalne

[English](README.md) | **Polski**

Dołączone źródła audytów pokazują kontrole wybranych zależności i wzorców kodu, między innymi kontraktów, konwencji integracji i granic modułów. Uzupełniają testy i sprawdzanie typów, ale nie dowodzą ogólnej poprawności.

## Przewodnik po kodzie

- [Kontrole kontraktów](tools/d1-contracts.ts) sprawdzają zależności między definicjami kontraktu a kodem aplikacji.
- [Kontrole Stripe](tools/stripe.ts) sprawdzają wybrane wzorce integracji.
- [Testy kontroli kontraktów](tools/d1-contracts.test.ts) pokazują testowanie narzędzi sprawdzających.

## Zakres tego wydania

Polecenie `npm run audit:all` uruchamia kontrole wymienione w [skrypcie zbiorczym](run-all.sh). Obejmują one m.in. zgodność kopii kernela, powiązanie kontraktów z trasami API, schemat bazy, integrację ze Stripe, reguły CSS, tłumaczenia i zgodność wygenerowanego kodu ze źródłem. Kontrola generatorów porównuje rejestry kontraktów, opis OpenAPI i typy DTO. Sprawdza także tekstowe wersje stron wygenerowane z opublikowanych tłumaczeń i artykułów. Narzędzia analizujące pełne środowisko wdrożeniowe pozostają poza zakresem zbiorczego polecenia.
