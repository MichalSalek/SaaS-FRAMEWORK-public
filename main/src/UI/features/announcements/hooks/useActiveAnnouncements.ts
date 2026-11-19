// main/src/UI/features/announcements/hooks/useActiveAnnouncements.ts
// GET /api/v1/announcements/active for one surface.
// Cached per person and active role so a role switch cannot reuse another
// account's rows. The query waits until that identity is known.

import { queryOptions, useQuery } from '@tanstack/react-query';
import { authClient } from '../../../../application/auth/better-auth-client';
import { getActiveAnnouncements_IO } from '../../../../domain/admin/announcements/adminAnnouncementsIO.possibilities.api';
import { queryKeys } from '../../../../application/http/queryKeys.factory';
import { backgroundQueryRetryOptions } from '../../../../application/http/background-retry-policy';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { useAuth } from '../../../contexts/AuthContext.composition';
import { useHydrated } from '../../../hooks/useHydrated';
import { useAppRole } from '../../../layouts/useAppRole';
import type { AnnouncementSurface } from '../announcement-display';

export type ActiveAnnouncement =
  ADMIN_DTO_API_V1['ANNOUNCEMENTS_GET_ACTIVE']['RESPONSE'][number];

const fetchActiveAnnouncements = getActiveAnnouncements_IO;

export function useActiveAnnouncements(surface: AnnouncementSurface) {
  const hydrated = useHydrated();
  const { isLoggedIn, accountType } = useAuth();
  const { isRoleUnknown, isSessionPending } = useAppRole();
  const { data: session } = authClient.useSession();
  const userId = session?.user.id ?? null;
  const guestReady = hydrated && !isLoggedIn && !isSessionPending;
  const memberReady =
    hydrated &&
    isLoggedIn &&
    !isSessionPending &&
    !isRoleUnknown &&
    userId !== null;
  const ready = guestReady || memberReady;
  const identity = !isLoggedIn ? 'guest' : (userId ?? 'pending');
  const role = accountType ?? 'none';

  const { data, isLoading, isError } = useQuery(
    queryOptions({
      queryKey: [
        ...queryKeys.public.activeAnnouncements,
        surface,
        identity,
        role,
      ],
      queryFn: ({ signal }) =>
        fetchActiveAnnouncements({ surface }, { signal }),
      enabled: ready,
      staleTime: 60_000,
      refetchInterval: 60_000,
      refetchOnWindowFocus: true,
      ...backgroundQueryRetryOptions,
    })
  );

  return {
    announcements: data ?? [],
    isLoading,
    isError,
    ready,
    isLoggedIn,
    accountType,
  };
}
