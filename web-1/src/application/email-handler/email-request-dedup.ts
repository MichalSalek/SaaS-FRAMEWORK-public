/**
 * In-process dedup for mails that carry a confirmation link (address change, deletion).
 * DECISION: tokens are stateless HMAC, so there is no row to condition on (owner). A double
 * tap on "Wyślij" joins the in-flight send instead of minting a second link. The window is
 * 60s and the key includes the target, so a later resend is not blocked. A failed send
 * releases the key. Two instances can each send once; both links stay valid.
 * Test: web-1/src/application/email-handler/email-request-dedup.test.ts (in-flight duplicate,
 * parallel double tap and release on failure, one process; not two instances).
 */

export const EMAIL_REQUEST_DEDUP_WINDOW_MS = 60_000;

const MAX_STORE_SIZE = 10_000;

type Entry = { promise: Promise<boolean>; sentAt: number | null };

const entries = new Map<string, Entry>();

const evictExpired = (now: number): void => {
  for (const [key, entry] of entries) {
    if (
      entry.sentAt !== null &&
      now - entry.sentAt >= EMAIL_REQUEST_DEDUP_WINDOW_MS
    ) {
      entries.delete(key);
    }
  }
};

export type EmailRequestOutcome = {
  /** The mail went out (for a joined request: the first request's mail did). */
  sent: boolean;
  /** This request did not send anything itself; it joined an identical one. */
  joined: boolean;
};

/**
 * Run `send` at most once per `key` inside the window. An identical request
 * arriving while the first is in flight waits for its REAL result; one arriving
 * after a successful send within the window gets `{ sent: true, joined: true }`.
 * A failed or throwing send frees the key (the throw propagates to its caller).
 */
export const runEmailRequestOnce = async (
  key: string,
  send: () => Promise<boolean>
): Promise<EmailRequestOutcome> => {
  const now = Date.now();
  const existing = entries.get(key);
  if (existing) {
    if (existing.sentAt === null) {
      return { sent: await existing.promise.catch(() => false), joined: true };
    }
    if (now - existing.sentAt < EMAIL_REQUEST_DEDUP_WINDOW_MS) {
      return { sent: true, joined: true };
    }
    entries.delete(key);
  }
  if (entries.size >= MAX_STORE_SIZE) {
    evictExpired(now);
    // Bounded memory under a flood of fresh keys: the oldest entry (Map keeps
    // insertion order) goes. Worst case: one extra mail.
    if (entries.size >= MAX_STORE_SIZE) {
      const oldest = entries.keys().next();
      if (!oldest.done) {
        entries.delete(oldest.value);
      }
    }
  }
  const entry: Entry = { promise: send(), sentAt: null };
  entries.set(key, entry);
  try {
    const sent = await entry.promise;
    if (sent) {
      entry.sentAt = Date.now();
    } else {
      entries.delete(key);
    }
    return { sent, joined: false };
  } catch (error) {
    entries.delete(key);
    throw error;
  }
};

/** Wyłącznie dla testów. */
export const __resetEmailRequestDedup = (): void => {
  entries.clear();
};
