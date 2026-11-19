// UI/features/stylist/StylistProfilePage.query.ts
// Query options of the public profile, extracted from the composition (max-lines
// 300). Canon: silentBusinessError + SSR initialData (the DECISION below).

import { queryOptions } from '@tanstack/react-query';
import { getPublicProfile_IO } from '../../../domain/account/accountIO.possibilities.api';
import { queryKeys } from '../../../application/http/queryKeys.factory';
import type { StylistProfileData } from './_jsonld.helpers';

export const profileQueryOptions = (
  identifier: string,
  initialProfile?: StylistProfileData | null
) =>
  queryOptions({
    queryKey: queryKeys.account.profile(identifier),
    // DECISION: a dead profile link (QR, card, typo) returns 404 and the page already renders
    // its own „not found” EmptyState, so the 404 must never also toast. The queryFn signal
    // makes it a 'background' read (error-feedback.policy); silentBusinessError keeps the
    // business 4xx silent regardless, while isError still drives the EmptyState.
    queryFn: ({ signal }) =>
      getPublicProfile_IO(
        { identifier },
        { signal, silentBusinessError: true }
      ),
    enabled: identifier.length > 0,
    staleTime: 60_000,
    // SSR initialData: the client does not refetch on cold load (fresh for staleTime).
    ...(initialProfile ? { initialData: initialProfile } : {}),
  });
