// useUpdateStylistProfile.ts
// D5 (run 25 TRD): single TanStack mutation hook for the consolidated profile endpoint.
// Replaces useSetLocation + useSetVanityUrl + useUpdateSocialLinks.
//
// DECISION (nie usuwaj tego komentarza):
// Jedna mutacja = atomowy zapis PODANEGO payloadu sekcji (backend $transaction
// per-payload). Po autosave (dyrektywa ownera 2026-07-12: koniec przycisków
// ZAPISZ) StylistProfileSection woła ją PER SEKCJA na onBlur/onChange
// (saveLocation/saveVanity/saveInstagram/saveAccent) — N niezależnych
// round-tripów zamiast jednego. Atomowość obejmuje pola JEDNEGO payloadu, nie
// wszystkich sekcji naraz. Wspólny hook = jeden kontrakt toast/spinner/invalidacja.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { updateStylistProfile_IO } from '../../../../domain/account/accountIO.possibilities.api';
import { invalidateStylistProfileCaches } from '../helpers/invalidate-stylist-profile.helper';
import type { ACCOUNT_DTO_API_V1 } from '@kernel/models/account/account.dto';

type UpdateStylistProfileRequest =
  ACCOUNT_DTO_API_V1['UPDATE_STYLIST_PROFILE']['REQUEST'];

export function useUpdateStylistProfile() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: UpdateStylistProfileRequest) =>
      updateStylistProfile_IO(req),
    // DECISION (nie usuwaj tego komentarza):
    // suppressGlobalError wyłącza tylko warstwę 3 (globalny MutationCache fallback).
    // Toast błędu NIE jest tu potrzebny: HTTP-interceptor (event-bus, warstwa 1)
    // zawsze toastuje błąd tej mutacji — ta ścieżka nie ustawia silentBusinessError,
    // więc backendowy event (np. VANITY_URL_ALREADY_EXISTS / walidacja / GENERAL_ERROR)
    // albo INTERNET_CONNECTION_PROBLEM na sieci/timeoutcie zawsze się pokaże,
    // i to bardziej precyzyjny niż lokalny CANNOT_UPDATE_STYLIST_PROFILE.
    // Lokalny onError został usunięty, bo dublował interceptor (inny klucz eventu
    // nigdy nie dedupuje w pushNewSnackbar → double-toast S51).
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      // Invalidate both own session and public stylist list (city/name/vanity may have changed).
      invalidateStylistProfileCaches(queryClient);
    },
  });
}
