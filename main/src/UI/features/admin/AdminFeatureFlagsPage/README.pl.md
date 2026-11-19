# Zarządzanie flagami funkcji

[English](README.md) | **Polski**

Strona administracyjna pokazuje flagi funkcji, ich kategorie, stan i termin
wygaśnięcia. Flagi pozwalają włączać wybrane zachowania niezależnie od wdrożenia
kodu. Ich definicje znajdują się we wspólnym kernelu.

## Definicja i wygasanie

`.shared-kernel/domain/feature-flags/feature-flags.config.ts` definiuje klucze,
wartości domyślne, kategorie i opisy. Typowane rejestry wymagają metadanych dla
zarejestrowanych kluczy. Model bazy `FeatureFlag` zawiera też opcjonalne `expires_at`.

Zadanie wygaszające wyłącza aktywne flagi po terminie, unieważnia cache i zapisuje
zdarzenie. Wygaśnięcie zależy od uruchomienia zadania; nie jest natychmiastowym
ograniczeniem wymuszanym przez bazę. Ponowne włączenie flagi na stronie usuwa datę
wygaśnięcia. Strona wyświetla daty, ale ich nie edytuje.

## Usuwanie flagi

Wygaśnięcie wyłącza zachowanie, lecz nie usuwa gałęzi kodu. Wycofanie flagi obejmuje
jej klucz, pozostałe odwołania i rekord bazy w skoordynowanej zmianie. Usunięcie
klucza ujawnia pozostałe typowane odwołania podczas kompilacji. Stałe przełączniki
operacyjne mogą celowo nie mieć terminu.

## Pliki

- `feature-flags.model.ts`: grupowanie, stan wygaśnięcia i kolejność.
- `AdminFeatureFlagsPage.row.molecule.tsx`: wiersz i stan zapisu.
- `AdminFeatureFlagsPage.group.organism.tsx`: grupa kategorii.
- Kompozycja strony w katalogu nadrzędnym: filtrowanie, liczniki i koordynacja mutacji.

Filtr po terminie ułatwia okresowy przegląd. Nieudany zapis optymistyczny przywraca
poprzedni stan przełącznika i pokazuje błąd w wierszu.
