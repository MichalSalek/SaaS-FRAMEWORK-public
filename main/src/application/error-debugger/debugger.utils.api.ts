import { getClientVerboseLog } from './client-verbose.state';

/**
 * Run the supplied callback only when verbose logging is on — the single
 * VERBOSE_LOG_MODE switch mirrored into client-verbose.state (see docs/LOGGING.md).
 * Same gate reportIssueFrontend uses for info logs, so a __debuggerGate block and an
 * info-mode reportIssueFrontend inside it fire together. Replaces the dead isDevMode
 * Zustand flag (which had no runtime toggle → these blocks never ran in prod).
 */
export const __debuggerGate = (evalOnDebugMode: () => void): void => {
  if (getClientVerboseLog()) {
    evalOnDebugMode();
  }
};

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
