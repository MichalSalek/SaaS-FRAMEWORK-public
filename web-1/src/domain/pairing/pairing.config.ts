/**
 * PAIRING CONFIGURATION
 *
 * Business rules:
 * - Token TTL: 15 minutes (security)
 * - Cleanup: 24h (remove expired tokens)
 * - Max active sessions: 5 per stylist (prevents token spam)
 *
 * NOTE: Pairing limits (max_paired_clients) are managed by PRICING_POLICY.LIMITS (SSOT)
 * See: .shared-kernel/policies/pricing.policy.ts
 */

export const PAIRING_CONFIG = {
  /**
   * Token time-to-live in minutes
   * Short-lived for security (offline→online bridge)
   */
  TOKEN_TTL_MINUTES: 15,

  /**
   * Cleanup interval for expired tokens (hours)
   * Prevents database bloat
   */
  CLEANUP_INTERVAL_HOURS: 24,

  /**
   * Max active sessions per stylist
   * Prevents token spam
   */
  MAX_ACTIVE_SESSIONS_PER_STYLIST: 5,

  /**
   * Okno, w którym ponowna prośba o połączenie po WŁASNYM wycofaniu jest
   * traktowana jak ta sama prośba wyrażona ponownie (bez maila, bez wpisu
   * audytu, bez pompowania lejka).
   *
   * Uzasadnienie i zmierzony wektor: DECISION w `pair-request.operations.ts`
   * przy `isRapidReassert`. Godzina jest kompromisem: prośba i tak ląduje
   * w aplikacji stylistki NATYCHMIAST (tłumimy wyłącznie powtórzone
   * powiadomienie), a pomyłkowe wycofanie i ponowienie po dłuższej przerwie
   * to realnie nowa próba kontaktu, więc mail wraca.
   */
  REQUEST_REASSERT_WINDOW_MINUTES: 60,
} as const;
