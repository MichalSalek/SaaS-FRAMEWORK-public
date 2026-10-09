# Feature Flag Retirement Convention

## Zasada

Każda **nowa** feature flag MUSI mieć ustawione `expires_at`.

Flagi bez `expires_at` to legacy — tolerowane dla wstecznej kompatybilności, ale nie akceptowalne dla nowych flag.

## Lifecycle flagi

```
Create → expires_at ustawione → Admin panel monitoring → expires_at - 30d: badge "Expires in X days"
                                                        → expires_at: badge "Overdue: X days"
                                                        → expires_at + 30d grace: usuń flagę via PR
```

## Egzekucja

- **Admin panel** wyświetla ostrzeżenie gdy `expires_at < now` (pigułka „Przeterminowana: X dni” w wierszu flagi)
- **Admin panel** wyświetla info gdy `expires_at` w ciągu 30 dni (pigułka „Wygasa za X dni”)
- **Admin panel** sortuje: przeterminowane pierwsze
- **Kafel „Przeterminowane”** nad listą jest filtrem: dotknięcie pokazuje tylko przeterminowane flagi, drugie dotknięcie wraca do wszystkich
- **Schema level**: nullable (nie enforced w DB) — legacy flags mają `expires_at = null`

## Kiedy ustawić expires_at

| Typ flagi                | Wartość                                                   |
| ------------------------ | --------------------------------------------------------- |
| Feature launch gate      | Data launchu + 60 dni                                     |
| A/B test                 | Data zakończenia testu                                    |
| Kill switch (tymczasowy) | Data planowanego usunięcia                                |
| Permanent infrastructure | NIE ustawiaj (lub ustaw na daleką przyszłość, np. +5 lat) |

## Usuwanie flagi

1. Po `expires_at` + 30 dni grace period
2. PR z:
   - Usunięcie flagi z `feature-flags.config.ts` (SSOT)
   - Usunięcie kodu bramkowanego flagą
   - Usunięcie flagi z DB (migration lub `db:push`)
3. Merge = flaga zretirowana

## Quarterly review

Otwórz admin panel → Flagi funkcji → dotknij kafla „Przeterminowane” (filtr) → rozpatrz każdą przeterminowaną flagę.

## Kod strony (S126)

| Plik                                       | Odpowiedzialność                                                              |
| ------------------------------------------ | ----------------------------------------------------------------------------- |
| `feature-flags.model.ts` (+ test)          | status wycofania, kategoria z kernela, grupowanie i kolejność (czysta logika) |
| `AdminFeatureFlagsPage.row.molecule.tsx`   | jedna flaga jako wiersz ustawienia: etykieta, klucz, linia stanu, przełącznik |
| `AdminFeatureFlagsPage.group.organism.tsx` | jedna kategoria w `AdminPanelMolecule`                                        |
| `AdminFeatureFlagsPage.composition.tsx`    | strona: odczyt, filtr przeterminowanych, księgowanie przełączeń               |

Przełącznik zapisuje optymistycznie; w trakcie zapisu wiersz pokazuje „Zapisywanie…”, a nieudany zapis jest opisany w tym samym wierszu (flaga wraca do poprzedniego stanu).
