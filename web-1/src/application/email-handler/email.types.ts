export type SendEmailParams = {
  to: string;
  subject: string;
  text?: string;
  html: string;
  headers?: Record<string, string>;
  tags?: string[];
  /**
   * Disable Mailgun click-tracking for this message (sets `o:tracking-clicks: no`).
   * REQUIRED for auth links (magic-link): click-tracking rewrites the href to a
   * Mailgun tracking domain, which (a) is NOT an OS-verified Universal/App Link so
   * the phone never opens the native app, and (b) leaks the one-time auth token to
   * the ESP. SMTP fallback is unaffected (no ESP link rewriting on raw SMTP).
   */
  disableClickTracking?: boolean;
};

export type CriticalBusinessAlertParams = {
  alertTitle: string;
  alertMessage: string;
  /** Readable list shown above the technical details (one entry per line). */
  lines?: readonly string[];
  /** One action link (admin panel, Stripe dashboard); http(s) only. */
  link?: { label: string; url: string };
  details: Record<string, unknown>;
};
