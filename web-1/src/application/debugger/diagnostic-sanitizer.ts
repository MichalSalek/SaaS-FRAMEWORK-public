import { isPrivateNoteKey } from '@kernel/application/diagnostic-redaction';
import { serializeErrorLike } from '@kernel/application/error-serialization';
import {
  isEmailKey,
  redactEmailValue,
  redactEmailsInText,
} from './pii-redaction';

// DECISION: universal sanitizer for logger payloads. Values under secret-list keys become
// '[REDACTED]', addresses under address keys become the domain only, and EVERY text leaf passes
// through `redactEmailsInText`. Headers, tokens, secrets, passwords, API keys and the Stripe
// signature are scrubbed BEFORE JSON.stringify, so even if a caller passes `req.headers` or
// `req.body`, secrets do not leak into EventLog.payload.
//
// The scrub goes DEEP, not one level: mail transport logs `payload: error` (magic-link.adapter:
// Resend/Mailgun/nodemailer) and an SMTP error carries the recipient INSIDE the message ("550 ...
// <user@x.com>: Recipient address rejected"). `message` is not an address key, so it went to the log
// store verbatim on the product's ONLY login path, and a key nested one level down
// (`payload: { responseBody: { ... } }`) bypassed the scrub the same way. A clean-looking sibling
// payload made the record LOOK clean (the trap described at `redactEmailsInText`). Depth is bounded
// (cycles, monster payloads) and beyond it we return '[TOO_DEEP]', never the raw branch: unscanned
// data must not look scanned.
const SENSITIVE_KEY_REGEX =
  /^(authorization|cookie|set-cookie|x-internal-secret|stripe-signature|token|password|api[_-]?key|secret|access[_-]?token|refresh[_-]?token|bearer)$/i;
const REDACTED = '[REDACTED]';

// Email redaction: the keys and the function live in `pii-redaction.ts`
// (one set for BOTH log-store writers; see the DECISION in that file).
const MAX_REDACTION_DEPTH = 6;

const redactLeaf = (value: unknown): unknown =>
  typeof value === 'string' ? redactEmailsInText(value) : value;

/** Adres albo tablica adresow — jedyne ksztalty, ktore redaguje `redactEmailValue`. */
const isAddressShaped = (value: unknown): boolean =>
  typeof value === 'string' ||
  (Array.isArray(value) && value.every(item => typeof item === 'string'));

/**
 * DECISION: there is deliberately NO handling of `Date`/`Map`/`Set` here. This function always
 * runs BEHIND `serializeErrorLike`, and the core normalizes `Date` to ISO before
 * anything reaches it. A `Date -> toISOString` branch once added here passed its test EVEN AFTER the
 * branch was removed (the test could not touch it): dead code plus a test that cannot fail on its own
 * regression class buys confidence it does not cover. If `Map`/`Set`/`RegExp` ever really reach a
 * payload (zero such calls today), the fix belongs in
 * `.shared-kernel/application/error-serialization.ts`, the only place on this path that sees them.
 */
export const redactSensitive = (input: unknown, depth = 0): unknown => {
  if (input === null || typeof input !== 'object') {
    return redactLeaf(input);
  }
  if (depth >= MAX_REDACTION_DEPTH) {
    return '[TOO_DEEP]';
  }
  if (Array.isArray(input)) {
    return input.map(item => redactSensitive(item, depth + 1));
  }
  return redactObject(input as Record<string, unknown>, depth);
};

const redactObject = (
  obj: Record<string, unknown>,
  depth: number
): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const key of Object.keys(obj)) {
    const value = obj[key];
    if (SENSITIVE_KEY_REGEX.test(key) || isPrivateNoteKey(key)) {
      out[key] = REDACTED;
    } else if (isEmailKey(key) && isAddressShaped(value)) {
      // An address key is redacted DOWN TO THE DOMAIN (the operational signal stays), but only when
      // the value ACTUALLY has the shape of an address; otherwise this branch was a scan hole:
      // `emails: [{ to, token }]` passed untouched together with the secret inside. A value that
      // does not match takes the normal deep path.
      out[key] = Array.isArray(value)
        ? value.map(redactEmailValue)
        : redactEmailValue(value);
    } else {
      out[key] = redactSensitive(value, depth + 1);
    }
  }
  return out;
};

/** Sanitize legacy JSON diagnostic strings; non-JSON text keeps its existing contract. */
export const sanitizeDiagnosticJsonString = (input: string): string => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(input);
  } catch {
    return input;
  }
  try {
    const sanitized = JSON.stringify(
      redactSensitive(serializeErrorLike(parsed))
    );
    return sanitized === JSON.stringify(parsed) ? input : sanitized;
  } catch {
    // Valid JSON that cannot be sanitized must never fall back to the raw value.
    return '[Unserializable payload]';
  }
};
