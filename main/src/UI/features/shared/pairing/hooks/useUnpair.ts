// UI/features/shared/pairing/hooks/useUnpair.ts
// TQ v5 mutation -- POST /api/v1/pairing/revoke-access
// Revokes access/unpairs a stylist from the current client account.
// Stack: TanStack Query v5.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { useTranslations } from 'next-intl';
import { pushNewSnackbar } from '../../../../../application/app-snackbar/appSnackbar.possibilities.api';
import { pairingRevokeAccess } from '../../../../../domain/pairing/pairingIO.possibilities.api';
import { queryKeys } from '../../../../../application/http/queryKeys.factory';
import type { PAIRING_DTO_API_V1 } from '@kernel/models/pairing/pairing.dto';

/* --- Types --- */

type RevokeRequest = PAIRING_DTO_API_V1['PAIRING_ACCESS_REVOKE']['REQUEST'];

/* --- Hook --- */

// Success-toast key differs per side: a client unpairs FROM a stylist
// ('unpairSuccess'), a stylist disconnects a client ('stylistUnpairSuccess').
// Default preserves the original client-side behaviour (zero call-site churn).
export function useUnpair(opts?: {
  successMessageKey?:
    'unpairSuccess' | 'stylistUnpairSuccess' | 'freeSlotSuccess';
}) {
  const t = useTranslations('pages.pairing');
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: (req: RevokeRequest) => pairingRevokeAccess(req),
    meta: { suppressGlobalError: true },

    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: queryKeys.pairing.all });
      // Mirror serwerowego cascade: revokePairingAccess zamyka wszystkie
      // nie-terminalne SessionContainery klient<->stylista (pairing-access.operations).
      // Lista sesji klienta to osobny namespace (sessionContainer.*, staleTime 30s) —
      // bez tej invalidacji UI pokazywaloby zamkniete sesje jako otwarte do 30s.
      void queryClient.invalidateQueries({
        queryKey: queryKeys.sessionContainer.all,
      });
      // Mirror pelnej revoke-cascade: revokePairingAccess kasuje rowniez nie-pinned
      // ulubione klienta od tego stylisty (favoriteGalleryRecord.deleteMany).
      // Bez tych invalidacji usuniete ulubione wisialyby na FavoritesPage (favorite.*,
      // staleTime 60s), a serca na Explore zostawalyby wypelnione do 60s (gallery.*).
      void queryClient.invalidateQueries({ queryKey: queryKeys.favorite.all });
      void queryClient.invalidateQueries({ queryKey: queryKeys.gallery.all });
      pushNewSnackbar(t(opts?.successMessageKey ?? 'unpairSuccess'), 'success');
    },
    // DECISION (nie usuwaj tego komentarza): ZERO lokalnego onError-toasta.
    // suppressGlobalError gasi tylko warstwę 3 (MutationCache); błąd tej mutacji
    // toastuje warstwa 1 (HTTP interceptor) — pairingRevokeAccess nie ustawia
    // silentBusinessError, więc backendowy event / INTERNET_CONNECTION_PROBLEM
    // zawsze się pokaże. Lokalny t('unpairError') = inny klucz niż event
    // interceptora → Sonner id nie łapie → double-toast (S51/S74).
    // Kontrakt 3-warstwowy: queryClient.config.ts.
  });
}
