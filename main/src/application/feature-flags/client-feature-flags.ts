import { useQuery } from '@tanstack/react-query';
import {
  FEATURE_FLAG_DEFAULTS,
  type FeatureFlagKey,
} from '@kernel/domain/feature-flags/feature-flags.config';
import type { ADMIN_DTO_API_V1 } from '@kernel/models/admin/admin.dto';
import { defineEndpoint } from '../http/io';
import { ENDPOINTS } from '../http/http.endpoints';
import { queryKeys } from '../http/queryKeys.factory';
import { backgroundQueryRetryOptions } from '../http/background-retry-policy';

// FDX FAZA 2 (W2.4): zmigrowane na unified promise-first front-door
// (`defineEndpoint`). Kanon publicznego odczytu feature-flag (martwy duplikat
// w adminIO usunięto). Fail-soft (resolve {} on reject) żyje teraz w
// `fetchPublicFlags` try/catch, nie w callback-based IO — patrz DECISION w io.ts.
const getFeatureFlagsPublic_IO = defineEndpoint<
  ADMIN_DTO_API_V1['GET_FEATURE_FLAGS_PUBLIC']['REQUEST'],
  ADMIN_DTO_API_V1['GET_FEATURE_FLAGS_PUBLIC']['RESPONSE'],
  ADMIN_DTO_API_V1['GET_FEATURE_FLAGS_PUBLIC']['RESPONSE_ERROR']
>({
  url: ENDPOINTS.GET_FEATURE_FLAGS_PUBLIC,
  mode: 'get',
  errorFeedbackPolicy: 'background',
});

const STALE_MS = 5 * 60 * 1000;

// DECISION (nie usuwaj tego komentarza):
// `Partial<Record<FeatureFlagKey, boolean>>` instead of `Record<string, boolean>`:
// the backend may return a subset of flags (legacy / new key drift), so the
// `key in flags` safety pattern below stays. Strong typing prevents the API
// surface from drifting away from the FEATURE_FLAG_KEYS SSOT — a typo on a
// caller's side now fails at compile time.
type FeatureFlagMap = Partial<Record<FeatureFlagKey, boolean>>;

interface PublicFlags {
  flags: FeatureFlagMap;
}

async function fetchPublicFlags(opts: {
  signal?: AbortSignal;
}): Promise<PublicFlags> {
  // Promise-first IO resolves with the UNWRAPPED response body (`response.data`
  // of the old callback) — here a `Record<string, boolean>` of flags. Errors are
  // allowed to reach TanStack Query so the explicit background retry policy can
  // distinguish connectivity from HTTP failures; the hook below still fails soft
  // to FEATURE_FLAG_DEFAULTS after the query settles in error.
  const flags = await getFeatureFlagsPublic_IO(
    undefined,
    opts.signal ? { signal: opts.signal } : undefined
  );
  return { flags: flags as FeatureFlagMap };
}

/**
 * Client-side public feature flag hook. Mirrors `getFeatureFlagServerSide` —
 * sources truth from the live backend, falls back to FEATURE_FLAG_DEFAULTS
 * when offline. Cached for 5 min via TanStack Query so the public footer
 * (rendered on every page) hits the network at most once per session.
 */
export function usePublicFeatureFlag(key: FeatureFlagKey): boolean {
  const { data, isError } = useQuery({
    queryKey: queryKeys.public.featureFlags,
    queryFn: ({ signal }) => fetchPublicFlags({ signal }),
    staleTime: STALE_MS,
    gcTime: 15 * 60_000,
    ...backgroundQueryRetryOptions,
  });
  const flags: FeatureFlagMap = isError ? {} : (data?.flags ?? {});
  if (key in flags) {
    return flags[key] ?? FEATURE_FLAG_DEFAULTS[key];
  }
  return FEATURE_FLAG_DEFAULTS[key];
}
