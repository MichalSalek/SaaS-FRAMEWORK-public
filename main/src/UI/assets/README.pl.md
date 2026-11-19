# Statyczne materiały graficzne

[English](README.md) | **Polski**

Katalog definiuje typowane odwołania do obrazów interfejsu i stron publicznych.
Rejestr zapewnia wspólny sposób wyboru obrazu, w tym wariantów językowych
oraz źródeł dla różnych rozmiarów.

## Obieg materiałów

Źródłowe grafiki i prywatna biblioteka materiałów są utrzymywane osobno. Pliki
używane przez aplikację znajdują się w `main/public/`, a rejestr wskazuje ich
publiczne ścieżki. Zdjęcia galerii dodawane przez użytkowników obsługuje usługa
obrazów, poza rejestrem statycznym.

Komponenty korzystają z `LP_ASSETS` i istniejących helperów zamiast powtarzać
ścieżki. Sąsiednie użycia pokazują oczekiwany kształt definicji i wybór języka
zastępczego. Wymiary oraz warianty responsywne pozostają przy definicji.

## Dodawanie lub wymiana obrazu

1. Przygotuj plik i potrzebne warianty językowe lub rozmiarowe.
2. Dodaj albo zmień wpis rejestru.
3. Użyj istniejącego helpera renderowania w danej funkcji.
5. Sprawdź wynik przy docelowej szerokości i motywie.

Walidacja rejestru sprawdza odwołania do plików. Nie ocenia kadru, tematu zdjęcia
ani poprawności tekstu na stronie.

## Powiązane opisy

- [Architektura UI](../UI_ARCHITECTURE.md)
- [Definicje poleceń](../../../../package.json)
