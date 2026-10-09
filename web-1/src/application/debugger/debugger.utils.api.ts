import { getCurrentRequestTarget } from '@app/http/request-context';

export const captureStackTrace = (): string[] => {
  // Tworzymy nowy obiekt Error tylko po to, żeby dostać stack trace
  // Nie rzucamy go, tylko używamy jako narzędzia
  const error = new Error();

  // Właściwość stack to string z całym stack trace
  // Każda linia reprezentuje jedno wywołanie funkcji
  const stackLines = error.stack?.split('\n') || [];

  // Pierwsza linia to zazwyczaj "Error" (nazwa błędu)
  // Druga linia to to wywołanie captureStackTrace
  // Trzecia linia to funkcja, która wywołała captureStackTrace (nasza funkcja logująca)
  // Dopiero od czwartej linii zaczynają się "prawdziwe" wywołania, które nas interesują

  return stackLines
    .slice(3) // Usuwamy pierwsze 3 linie, żeby pozbyć się szumu
    .slice(0, 5); // Możesz zdecydować, ile linii stack trace chcesz zachować
};

/**
 * Marker dla logów powstałych poza obsługą żądania: startup, hooki SIGTERM,
 * sweepy odpalane w tle. Świadomie jeden stały napis zamiast `null` — kolumna
 * `client_url` jest NOT NULL, a jawny marker filtruje się w panelu admina.
 */
export const SYSTEM_CLIENT_URL = 'system';

/**
 * Cel bieżącego żądania (`METHOD /pathname`) do kolumny `client_url`.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Wcześniej zwracało `FRONTEND_PUBLIC_DOMAIN + ':' + FRONTEND_PUBLIC_PORT`, czyli
 * na produkcji STAŁE `"nailfolio.app:"` w KAŻDYM rekordzie (port pusty). Kolumna
 * nie niosła więc żadnej informacji, a przy diagnozie incydentu 2026-07/08 nie dało
 * się z log-store odczytać, który endpoint sypie. Teraz źródłem jest ALS ustawiony
 * w timing.middleware — bez przepinania sygnatur ~100 call-site'ów reportIssueBackend.
 * Środowisko i tak żyje w osobnej kolumnie `environment`, więc domena była duplikatem.
 */
export const getClientURL = (): string =>
  getCurrentRequestTarget() ?? SYSTEM_CLIENT_URL;
