import { useMutation, useQueryClient } from '@tanstack/react-query';
import { gdprEraseAccount_IO } from '../../../../domain/user/userIO.possibilities.api';
import { signOut } from '../../../../application/auth/better-auth-client';
import { deleteFromClientStorage } from '../../../../application/client-device-storage/clientStorage.possibilities.api';
import { CUSTOM_HEADERS } from '@kernel/domain/http/http.config';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import type { USER_DTO_API_V1 } from '@kernel/models/user/user.dto';
import type { QueryClient } from '@tanstack/react-query';
import { trackFlowStep } from '../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../shared/analytics/flowErrorCode';

/* ─── Types ─── */

export type GdprEraseResponse = USER_DTO_API_V1['USER_GDPR_ERASE']['RESPONSE'];

/* ─── Sign-out + redirect ─── */

// DECISION: after erasure the record no longer exists, so Better Auth signOut() may itself 401/fail.
// It is best-effort: local tokens + cache are ALWAYS purged, then a hard navigation to HOME.
// window.location (not the SPA router) guarantees a clean slate with no stale in-memory
// auth/session state.
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
    onError: error => {
      trackFlowStep('account', 'failed', {
        action: 'erase',
        code: flowErrorCode(error),
      });
    },
    onSuccess: () => {
      trackFlowStep('account', 'erased');
      void clearSessionAndGoHome(queryClient);
    },
  });
}
