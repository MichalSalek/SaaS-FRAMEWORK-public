/**
 * Messaging domain errors (stylist<->client komunikator).
 *
 * MESSAGING_PAIR_NOT_FOUND = para nie istnieje ALBO wołający nie jest jej stroną.
 * ŚWIADOMIE jeden typ (anti-enumeration): nie rozróżniamy "nie ma" od "nie twoja"
 * — inaczej 404-vs-403 zdradzałby, które pair_id są realne (IDOR). Error-mapper
 * mapuje go na jednolite 404 (parytet SUPPORT_THREAD_NOT_FOUND/NOT_AUTHORIZED).
 *
 * MESSAGING_NOT_ALLOWED = wołający JEST stroną, ale para REVOKED → wysyłka
 * zablokowana (historia read-only). 403 — bez maskowania, bo caller to legit
 * strona zerwanej relacji.
 *
 * MESSAGING_RATE_LIMITED = przekroczony godzinowy limit wysyłek usera → 429.
 * Niesie `retryAfterSeconds`, bo bez tego odpowiedź była nieodróżnialna od 429
 * limitera per-IP, a nagłówki tego limitera opisują JEGO okno (kilkanaście
 * sekund) — klient honorujący standardowe nagłówki ponawiał więc co kilkanaście
 * sekund przez godzinę, a każde ponowienie to transakcja Serializable, dwa
 * zliczenia i wpis do error-store'a. Wartość liczymy z najstarszej wiadomości
 * w oknie, więc jest prawdziwa, a nie zaokrąglona do pełnego okna.
 */

export type MessagingPairNotFoundError = {
  type: 'MESSAGING_PAIR_NOT_FOUND';
};

export type MessagingNotAllowedError = {
  type: 'MESSAGING_NOT_ALLOWED';
};

export type MessagingRateLimitedError = {
  type: 'MESSAGING_RATE_LIMITED';
  retryAfterSeconds: number;
};

export type MessagingError =
  | MessagingPairNotFoundError
  | MessagingNotAllowedError
  | MessagingRateLimitedError;
