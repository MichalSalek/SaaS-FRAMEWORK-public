/**
 * SSOT for the keys that carry an E-MAIL ADDRESS in logs, and for the redaction itself.
 *
 * DECISION: ONE source of email-bearing keys for BOTH log-store writers (`error-handler.ts`, which
 * redacts to the domain, and `event-log/event-log-io.wrapper.ts`, which drops the key). Two
 * independent lists had diverged exactly where it hurts. The MECHANISM stays different on purpose:
 * the logger redacts to the domain (it needs the signal about a provider failure), while the
 * defense-in-depth on raw bodies drops the key entirely. `identifier` is in the set deliberately:
 * it is the recipient field in the magic-link adapter, the ONLY login path.
 *
 * Redact to the DOMAIN only, never a hash: the address space is dictionary-like, so an unsalted hash
 * reverses with a rainbow table (pseudonymization posing as anonymization).
 */

/** Field names that CANNOT be derived from the pattern (no "mail" in them), so they are listed. */
export const EMAIL_KEY_NAMES = [
  'to',
  'recipient',
  'recipients',
  'from',
  'replyTo',
  'reply_to',
  'identifier',
] as const;

const EMAIL_KEY_SET = new Set<string>(
  EMAIL_KEY_NAMES.map(name => name.toLowerCase())
);

const EMAIL_KEY_PATTERN = /e?mails?$/;

/**
 * Whether an e-mail address is expected under this key. Separators are stripped BEFORE matching so
 * `user_email`, `userEmail` and `USEREMAIL` are one question. A false positive is cheap:
 * `redactEmailValue` returns a non-address value untouched.
 */
export const isEmailKey = (key: string): boolean => {
  const normalized = key.toLowerCase().replace(/[_\-.]/g, '');
  return (
    EMAIL_KEY_SET.has(key.toLowerCase()) || EMAIL_KEY_PATTERN.test(normalized)
  );
};

const EMAIL_VALUE_REGEX = /^[^\s@]+@([^\s@]+\.[^\s@]+)$/;

/** Global variant for FREE TEXT (log messages, exception text). */
const EMAIL_IN_TEXT_REGEX = /[^\s@"'<>()[\]{},;:]+@([\w-]+(?:\.[\w-]+)+)/g;

/**
 * A package version is NOT a domain: `next@16.3.4` matches the address pattern, and since text
 * redaction walks EVERY payload leaf, "Cannot find module next@16.3.4" came back from the logs as
 * "[EMAIL]@16.3.4" and the reader could not tell what was there.
 *
 * EXACTLY three components (plus an optional prerelease/build suffix), i.e. semver and not
 * "anything with dots and digits": a looser `^\d+(\.\d+)+$` would let `bob@192.168.1.10` through
 * as a "version", a hole in the redaction. The suffix is there because module-resolution errors
 * usually carry `next@16.3.4-canary.12`.
 */
const VERSION_LIKE_DOMAIN = /^\d+\.\d+\.\d+([-+][\w.]+)?$/;

/**
 * Redacts addresses embedded in a sentence. Not over-zealous: messages in this repo glue the
 * address into the text (`Invalid email address: "${params.to}"`), and `message` used to reach the
 * log store and PostHog untouched, worse than no redaction because the payload next to it was
 * already redacted, so the record LOOKED clean.
 */
export const redactEmailsInText = (text: string): string =>
  text.replace(EMAIL_IN_TEXT_REGEX, (full: string, domain: string) =>
    VERSION_LIKE_DOMAIN.test(domain) ? full : `[EMAIL]@${domain}`
  );

/**
 * `anna.kowalska@gmail.com` → `[EMAIL]@gmail.com`.
 * A value that is not an address comes back untouched: `to: 'ACTIVE'` or `recipient: 42` are
 * legitimate non-address uses of the same field names.
 */
export const redactEmailValue = (value: unknown): unknown => {
  if (typeof value !== 'string') {
    return value;
  }
  const match = EMAIL_VALUE_REGEX.exec(value.trim());
  if (match) {
    return `[EMAIL]@${match[1]}`;
  }
  // Matching the WHOLE value is not enough: the mail transport produces the display-name form
  // `"Anna Kowalska" <anna@x.com>` under the `to`/`identifier` keys this module exists for, and
  // such a value would leave verbatim with the address inside. A non-address (`to: 'ACTIVE'`)
  // has nothing to match and comes back untouched.
  return redactEmailsInText(value);
};
