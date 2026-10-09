# Panel administracyjny

Strony panelu: `src/pages/app/admin`. Kompozycje i ich hooki znajdują się w tym katalogu; wspólną nawigację i ramę zapewnia `AdminPageLayout`.

## Macierz uprawnień

- Role z `is_system=true` są tylko do odczytu, także dla master admina. Ich uprawnienia pochodzą z konfiguracji kernela; backend odrzuca próbę zmiany przed zapisem.
- Wyszukiwarka obejmuje nazwę zdarzenia, opis i kategorię. Szybkie filtry kategorii powstają z odczytanych danych.
- Filtry zmieniają widoczne wiersze, zachowując szkic całej macierzy. Zapis obejmuje wyłącznie zmienione role niestandardowe.
- API pobiera pełny zestaw uprawnień porcjami; nie ogranicza całej macierzy do jednej strony wyników.

## Zapisy i filtry

Równoległe zapisy mają osobny stan oczekiwania dla każdego rekordu. Odpowiedź wcześniejszego zapisu nie może usuwać nowszego szkicu ani zamykać edytora innego rekordu. Filtry crawlerów korzystają ze wspólnego `useUrlSyncedState`; eksport audytu i paginacja czekają na dane właściwego filtra i strony.
