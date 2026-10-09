# Sanity produkcji (`tests/prod`)

> **Nawigacja:** [tests/README.md](../README.md) → Ten dokument

## Po co to jest

Produkcji nie dało się dotąd przetestować automatem. `dev-login` jest zamknięty poza środowiskiem deweloperskim (i słusznie: mintuje sesję administratora), więc każde sprawdzenie zalogowanej ścieżki na `nailfolio.app` kończyło się ręcznym klikaniem, a takie sprawdzenie robi się raz i nigdy więcej. Kosztowało to incydent z 17 sierpnia 2026: logowanie Google w aplikacji było zepsute i nikt tego nie łapał.

Ta suita loguje się na produkcji **tak jak człowiek**: prosi o magic-link i odbiera go ze skrzynki po IMAP. Dzięki temu w kodzie produkcyjnym nie ma ani jednej furtki testowej.

## Uruchomienie

```bash
npm run test:prod          # wszystko: warstwa bez sesji + logowanie magic-linkiem
npm run test:prod:smoke    # tylko warstwa bez sesji (nie wymaga skrzynki)
npm run test:prod -- --purge   # dodatkowo czyści skrzynkę testową na starcie
npm run test:prod:e2e      # wariant przeglądarkowy (Playwright, widok telefonu)
```

## Czego pilnuje

**Bez sesji**

| Sprawdzenie | Dlaczego akurat to |
|---|---|
| strona główna i ekran logowania | podstawowy sygnał życia frontu |
| `robots.txt` | statyki potrafiły leżeć dobę przy działającym HTML-u (zagnieżdżone `public/public`, 2 sierpnia 2026) |
| `site.webmanifest` (`display: standalone`) | ścieżka web-first do premiery w Play |
| `.well-known/assetlinks.json` | bez tego App Links przestają otwierać aplikację |
| `health-public` backendu | backend potrafi odpowiadać 200 ze starego artefaktu, więc to minimum, nie dowód |
| start natywnego logowania Google | 302 do Google **i** ciasteczko stanu w tej samej odpowiedzi (bez tego powrót z przeglądarki rozjeżdża się o cookie-jar) |
| nieznany kod wymiany → 404 | kontrakt mostu tokenowego, jednolita odpowiedź bez wycieku informacji |

**Z sesją** (potrzebne dane skrzynki)

| Sprawdzenie | Dlaczego akurat to |
|---|---|
| magic-link od prośby po token | jedna ścieżka pokrywa: wysyłkę maila (Resend/Mailgun), dostarczenie, most tokenowy i wymianę kodu |
| adres lądowania na origin frontu | gdy most przestanie przepisywać adres, użytkownik ląduje „w API", czyli nigdzie |
| `session/get-current` zwraca konto testowe | dowód, że token naprawdę otwiera sesję, a nie tylko istnieje |
| powtórna wymiana kodu → 404 | jednorazowość kodu |
| wylogowanie unieważnia token | testy nie zostawiają żywych sesji na produkcji |

## Skrzynka testowa

Dedykowana skrzynka `<e2e-mailbox>@nailfolio.app` u dostawcy poczty (`imap.example.com`, IMAP 993). Dane logowania żyją w lokalnym pliku z sekretami (poza repozytorium, tryb 600) jako `E2E_MAILBOX_USER`, `E2E_MAILBOX_PASSWORD`, `E2E_MAILBOX_IMAP_HOST`, `E2E_MAILBOX_IMAP_PORT`. Powłoka ładuje ten plik sama, więc `npm run test:prod` działa bez dodatkowych kroków; bez tych zmiennych suita wykonuje warstwę bez sesji i **mówi wprost**, że resztę pominęła.

Pierwsze uruchomienie zakłada na produkcji konto `<e2e-mailbox>@nailfolio.app` (zwykłe konto, bez uprawnień administratora). To jedyny ślad, jaki suita zostawia w bazie.

## Granice

- Testy **czytają**. Nie kasują cudzych danych, nie wgrywają zdjęć, nie ruszają płatności.
- Pełne logowanie Google nie jest tu skryptowane (ekran zgody Google jest poza naszą kontrolą). Pilnujemy jego **startu** oraz reguł podpinania konta, które incydent wywróciły; resztę tej ścieżki zamyka test jednostkowy `account-linking.config.test.ts`.
- Suita nie zastępuje `tests/e2e` (pełne przebiegi na środowisku deweloperskim, gdzie wolno psuć dane).
