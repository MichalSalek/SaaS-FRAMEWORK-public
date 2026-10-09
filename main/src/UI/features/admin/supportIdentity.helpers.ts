/**
 * Tożsamość rozmówcy w zgłoszeniu wsparcia: imię i adres albo tłumaczony
 * fallback.
 *
 * DECISION (nie usuwaj tego komentarza):
 * Do S104 endpoint szczegółu nie zwracał danych autora, więc operator widział
 * nazwisko na liście i „Klient" w wątku. Konto może być usunięte albo
 * przeniesione po 90 dniach (soft-FK) — wtedy backend oddaje pusty
 * string i zostaje tłumaczony fallback.
 *
 * S126: własny awatar panelu (odcień z hasha adresu, osobne inicjały) zniknął
 * razem z ręcznymi wierszami listy. Awatar w wątku to wspólny `AvatarAtom`,
 * który sam wylicza inicjały i ton z nazwy, tak samo jak wszędzie w produkcie.
 */

interface ThreadIdentitySource {
  user_name?: string;
  user_email?: string;
}

export interface ThreadIdentity {
  name: string;
  /** Address to show; the translated fallback when the account is gone. */
  email: string;
  /** The real address, or null: only a real one can open the user's card. */
  knownEmail: string | null;
}

export function resolveThreadIdentity(
  thread: ThreadIdentitySource | null | undefined,
  fallback: { name: string; email: string }
): ThreadIdentity {
  const name = thread?.user_name?.trim();
  const email = thread?.user_email?.trim();
  const hasName = name !== undefined && name.length > 0;
  const hasEmail = email !== undefined && email.length > 0;
  return {
    // Bez imienia osobą jest jej adres (jak na liście zgłoszeń).
    name: hasName ? name : hasEmail ? email : fallback.name,
    email: hasEmail ? email : fallback.email,
    knownEmail: hasEmail ? email : null,
  };
}
