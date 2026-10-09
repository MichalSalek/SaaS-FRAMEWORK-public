// UI/features/account/hooks/useGdprErase.ts
// ADRR Model A (§13.1) — TQ v5 mutation for POST /api/v1/user/gdpr-erase.
// GDPR Art. 17 permanent erasure on explicit request. This is the ONLY path to
// an actual hard-delete. On success the user record is gone, so we fully sign
// the user out client-side (clear tokens + cache + Better Auth session) and
// redirect to the landing page — there is no account left to return to.
// Stack: TanStack Query v5 + Better Auth client.

import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gdprEraseAccount_IO } from '../../../../domain/user/userIO.possibilities.api';
import { signOut } from '../../../../application/auth/better-auth-client';
import { deleteFromClientStorage } from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { QueryClient } from '@tanstack/react-query';

/* ─── Types ─── */

export type GdprEraseResponse = USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE'];

/* ─── Sign-out + redirect ─── */

// DECISION (nie usuwaj tego komentarza):
// After erasure the record no longer exists, so the Better Auth signOut() may
// itself 401/fail — we treat it as best-effort and ALWAYS purge local tokens +
// cache regardless, then hard-navigate to HOME. window.location (not the SPA
// router) guarantees a clean slate with no stale in-memory auth/session state.
async function clearSessionAndGoHome(queryClient: QueryClient): Promise<void> {
  try {
    await signOut();
  } catch {
    // best-effort — record/session is gone; local cleanup below is what matters.
  }
  deleteFromClientStorage({ key: CUSTOM_HEADERS.authorization });
  deleteFromClientStorage({ key: CUSTOM_HEADERS.becomeUser });
  await queryClient.cancelQueries();
  queryClient.clear();
  if (typeof window !== 'undefined') {
    window.location.href = ROUTES_FRONT.HOME;
  }
}

/* ─── Hook ─── */

export function useGdprErase() {
  const queryClient = useQueryClient();

  return useMutation<GdprEraseResponse, Error, void>({
    mutationFn: () => gdprEraseAccount_IO({}),
    meta: { suppressGlobalError: true },
    onSuccess: () => {
      void clearSessionAndGoHome(queryClient);
    },
  });
}
