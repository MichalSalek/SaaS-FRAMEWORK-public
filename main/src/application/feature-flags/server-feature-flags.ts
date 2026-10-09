import {
  FEATURE_FLAG_DEFAULTS,
  FEATURE_FLAG_KEYS,
  type FeatureFlagKey,
} from '@kernel/domain/feature-flags/feature-flags.config';
import { ROUTES_API } from '@kernel/domain/routing/routing.config';
import { buildBackendBaseUrl } from '../environment/backend-url';

// DECISION (nie usuwaj tego komentarza):
// `Partial<Record<FeatureFlagKey, boolean>>` instead of `Record<string, boolean>`:
// backend may return a subset of flags (legacy / new key drift). Strong typing
// keeps the SSR fetcher aligned with the FEATURE_FLAG_KEYS SSOT; the `key in flags`
// safety pattern below stays so a missing key falls through to defaults.
type FeatureFlagMap = Partial<Record<FeatureFlagKey, boolean>>;

/**
 * Server-side feature flag fetcher for SSR/ISR routes.
 *
 * Fetches the public feature flags endpoint with graceful fallback to
 * FEATURE_FLAG_DEFAULTS when backend is unreachable (build-time, dev offline,
 * outage). Use this in getServerSideProps / getStaticProps to gate public
 * routes (blog, sitemap, rss) — admin toggles propagate on next ISR
 * revalidation for static pages, and immediately for SSR.
 *
 * The runtime-reactive principle is preserved: source of truth is the live
 * backend value, defaults are only the offline safety net.
 */
async function fetchPublicFeatureFlags(): Promise<FeatureFlagMap> {
  try {
    const backendUrl = buildBackendBaseUrl();
    if (!backendUrl) {
      return {};
    }
    const apiUrl = `${backendUrl}${ROUTES_API.GET_FEATURE_FLAGS_PUBLIC}`;

    const response = await fetch(apiUrl, { method: 'GET' });
    if (!response.ok) {
      return {};
    }

    const json = (await response.json()) as { data?: Record<string, boolean> };
    return (json.data ?? {}) as FeatureFlagMap;
  } catch {
    // Graceful fallback — backend unreachable, dev mode, build-time offline
    return {};
  }
}

export async function getFeatureFlagServerSide(
  key: FeatureFlagKey
): Promise<boolean> {
  const flags = await fetchPublicFeatureFlags();
  if (key in flags) {
    return flags[key] ?? FEATURE_FLAG_DEFAULTS[key];
  }
  return FEATURE_FLAG_DEFAULTS[key];
}

export async function isBlogEnabledServerSide(): Promise<boolean> {
  return getFeatureFlagServerSide(FEATURE_FLAG_KEYS.BLOG_ENABLED);
}
