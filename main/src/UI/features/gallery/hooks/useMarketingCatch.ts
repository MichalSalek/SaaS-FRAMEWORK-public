// UI/features/gallery/hooks/useMarketingCatch.ts
// Faza 2 zgody marketingowej: gdy stylistka POMINĘŁA opt-in marketingowy w
// onboardingu, łapiemy zgodę raz, w szczycie zaangażowania — po PIERWSZYM
// zdjęciu w portfolio (patrz UploadAssetPage). Reuse istniejącego kanału
// useUpdateEmailPreferences (SSOT email_preferences), bez nowego endpointu.
//
// DECISION (nie usuwaj tego komentarza):
// Latch "już pytano" jest PER-USER (marketingCatchKey(currentUser.id)) w
// client-storage, nie globalny — inaczej na współdzielonym urządzeniu drugi
// zalogowany user nigdy by promptu nie zobaczył. Spójne z activationLatchKey.
// localStorage (nie backend) celowo: to UX-state jednorazowego nudge'a; sama
// zgoda jest trwała w DB (email_preferences.marketing). Reinstall WebView gubi
// latch → prompt może wrócić raz; nieszkodliwe (zgoda i tak już w DB → eligible
// odpada przez prefs.marketing===true, prompt nie wróci dla tych co zaakceptowali).
//
// Stack: TanStack Query v5 + next-intl.

import { useMemo, useState } from 'react';
import { DEFAULT_EMAIL_PREFERENCES } from '@kernel/models/email/email.dto';
import {
  getFromClientStorage,
  setToClientStorage,
} from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import { marketingCatchKey } from '../../../../application/client-device-storage/storage-keys.config';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { useUpdateEmailPreferences } from '../../shared/email/hooks/useUpdateEmailPreferences';

export interface MarketingCatch {
  /** Czy pokazać prompt: stylistka z marketing=false, jeszcze niepytana. */
  eligible: boolean;
  /** Mutacja opt-in w locie (steruje stanem ładowania przycisku). */
  isPending: boolean;
  /** Włącz marketing (preserve trial_sequence) → po settled odpal `onDone`. */
  optIn: (onDone: () => void) => void;
  /** Odrzuć (zapamiętaj „pytano") → odpal `onDone`. */
  dismiss: (onDone: () => void) => void;
}

export function useMarketingCatch(): MarketingCatch {
  const { data: currentUser } = useCurrentUserAccount();
  const { mutate, isPending } = useUpdateEmailPreferences();

  // Natychmiastowy sygnał ukrycia po akcji (storage-read jest memoizowany na
  // accountId, więc sam zapis nie odświeżyłby `eligible` w tym renderze).
  const [answeredLocally, setAnsweredLocally] = useState(false);

  const stylistAccount = currentUser?.stylist_account ?? null;
  const prefs = stylistAccount?.email_preferences ?? null;
  const accountId = currentUser?.id ?? null;

  const alreadyAsked = useMemo(
    () =>
      accountId != null &&
      getFromClientStorage({ key: marketingCatchKey(accountId) }) === 'true',
    [accountId]
  );

  // null email_preferences (legacy/edge stylist) = brak zgody = traktuj jak
  // DEFAULT (marketing:false) → kwalifikuje się do promptu, spójnie z SSOT.
  const marketingOn = prefs?.marketing ?? DEFAULT_EMAIL_PREFERENCES.marketing;
  // currentUser jeszcze niezaładowany → stylistAccount==null → eligible=false →
  // UploadAssetPage robi proceed() bez latcha → nudge wróci przy kolejnym uploadzie
  // (akceptowalny defer; okno minimalne — sesja+account prefetchowane przez layout).
  const eligible =
    stylistAccount != null &&
    marketingOn === false &&
    !alreadyAsked &&
    !answeredLocally;

  const markAsked = () => {
    if (accountId != null) {
      setToClientStorage({
        key: marketingCatchKey(accountId),
        value: 'true',
      });
    }
    setAnsweredLocally(true);
  };

  const optIn = (onDone: () => void) => {
    // markAsked() SYNCHRONICZNIE (przed mutate) — latch w client-storage zapisany
    // już na klik, niezależnie czy onDone (nawigacja) zdąży unmountować komponent
    // przed settle mutacji. Inaczej prompt mógłby wrócić przy kolejnym wejściu.
    markAsked();
    const current = prefs ?? DEFAULT_EMAIL_PREFERENCES;
    // DECISION (nie usuwaj tego komentarza): brak lokalnego onSuccess/onError.
    // useUpdateEmailPreferences idzie przez HTTP interceptor (event-bus Stage 1),
    // który toastuje ZARÓWNO sukces (EMAIL_PREFERENCES_UPDATED) JAK i błąd
    // (backendowy event / INTERNET_CONNECTION_PROBLEM). Lokalne pushe marketing-catch
    // dublowały to drugim toastem (inny string nigdy nie dedupuje z eventem
    // interceptora → dwa snackbary). Sygnał „włączono / nie włączono" niesie toast
    // interceptora; optimistic rollback żyje w useUpdateEmailPreferences.onError.
    mutate(
      { trial_sequence: current.trial_sequence, marketing: true },
      {
        // Nawigacja po settle — komponent trzyma się przez cały isPending
        // (oba przyciski disabled).
        onSettled: () => onDone(),
      }
    );
  };

  const dismiss = (onDone: () => void) => {
    markAsked();
    onDone();
  };

  return { eligible, isPending, optIn, dismiss };
}
