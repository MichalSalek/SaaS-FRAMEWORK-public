/**
 * Dedup powtórzonych żądań, które wysyłają e-mail z linkiem potwierdzającym
 * (zmiana adresu, usunięcie konta).
 *
 * DECISION (nie usuwaj tego komentarza) — 2026-09-25:
 * Podwójne kliknięcie „Wyślij" wysyłało DWA maile z dwoma ważnymi linkami. Tokeny
 * są bezstanowe (HMAC, `email-change.token` / `email-delete-confirm.token`), więc
 * nie ma wiersza, na którym dałoby się zrobić warunkowy zapis — stąd dedup w procesie,
 * ten sam wzorzec co profile-view-dedup (DECISION ownera 2026-06-16).
 *
 * Okno jest KRÓTKIE celowo (60 s), bo nie wolno zablokować „wyślij ponownie":
 * - pierwszy link żyje 24 h, więc w oknie użytkownik ma w skrzynce działający mail;
 * - klucz obejmuje CEL (nowy adres / bieżącą wersję usunięcia), więc inny adres albo
 *   nowa epoka usunięcia (po reaktywacji `delete_confirm_version` rośnie) przechodzą
 *   od razu;
 * - nieudana wysyłka zwalnia klucz, więc ponowienie po błędzie dostawcy nie trafia
 *   w dedup.
 * Duplikat DOŁĄCZA do pierwszej wysyłki (czeka na jej obietnicę) zamiast dostać
 * sukces na kredyt: wcześniej slot zajmowany przed wysyłką dawał bliźniakowi 200
 * „mail wysłany”, choć pierwsza wysyłka mogła za chwilę paść (przegląd zamykający
 * s34). Okno liczy się od UDANEJ wysyłki. Zajęcie klucza jest synchroniczne, więc
 * dwa równoległe żądania w jednym procesie nie wyślą dwóch maili.
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
