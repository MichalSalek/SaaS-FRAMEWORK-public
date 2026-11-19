import { timingSafeEqual } from 'node:crypto';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import { ENV_VARS } from '../environment/environment.config';
import { ENDPOINTS, type EndpointURLFunction } from './http.endpoints';

export type PublicDependencyKey =
  'featureFlags' | 'announcements' | 'runtimeConfig';

export type PublicDependencyCheck = {
  ok: boolean;
  status: number;
  durationMs: number;
};

export type PublicDependencyHealth = {
  ok: boolean;
  checks: Record<PublicDependencyKey, PublicDependencyCheck>;
  checkedAt: string;
};

export type PublicDependencyFetch = (
  url: string,
  init: RequestInit
) => Promise<Response>;

type PublicDependencyDefinition = {
  endpoint: EndpointURLFunction;
  expectedEvent: string;
};

const PUBLIC_DEPENDENCIES = {
  featureFlags: {
    endpoint: ENDPOINTS.GET_FEATURE_FLAGS_PUBLIC,
    expectedEvent: APP_EVENTS.INFO.ADMIN.FEATURE_FLAGS_FETCHED,
  },
  announcements: {
    endpoint: ENDPOINTS.ANNOUNCEMENTS_GET_ACTIVE,
    expectedEvent: APP_EVENTS.INFO.APPLICATION.ACTIVE_ANNOUNCEMENTS_FETCHED,
  },
  runtimeConfig: {
    endpoint: ENDPOINTS.GET_RUNTIME_CONFIG_PUBLIC,
    expectedEvent: APP_EVENTS.INFO.APPLICATION.PUBLIC_RUNTIME_CONFIG_FETCHED,
  },
} as const satisfies Record<PublicDependencyKey, PublicDependencyDefinition>;

type ProbeOptions = {
  fetchImpl?: PublicDependencyFetch;
  now?: () => number;
  timeoutMs?: number;
};

export const verifySyntheticMonitorSecret = (
  configuredSecret: string | undefined,
  suppliedSecret: string | string[] | undefined
): boolean => {
  if (!configuredSecret || typeof suppliedSecret !== 'string') {
    return false;
  }
  const configuredBuffer = Buffer.from(configuredSecret);
  const suppliedBuffer = Buffer.from(suppliedSecret);
  return (
    configuredBuffer.length === suppliedBuffer.length &&
    timingSafeEqual(configuredBuffer, suppliedBuffer)
  );
};

const readEvent = async (response: Response): Promise<unknown> => {
  try {
    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null || !('event' in body)) {
      return undefined;
    }
    return (body as { event?: unknown }).event;
  } catch {
    return undefined;
  }
};

const probeDependency = async (
  definition: PublicDependencyDefinition,
  fetchImpl: PublicDependencyFetch,
  now: () => number,
  timeoutMs: number
): Promise<PublicDependencyCheck> => {
  const startedAt = now();
  try {
    const response = await fetchImpl(definition.endpoint({ ENV_VARS }), {
      method: 'GET',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(timeoutMs),
    });
    const event = await readEvent(response);
    return {
      ok: response.ok && event === definition.expectedEvent,
      status: response.status,
      durationMs: Math.max(0, now() - startedAt),
    };
  } catch {
    return {
      ok: false,
      status: 0,
      durationMs: Math.max(0, now() - startedAt),
    };
  }
};

/**
 * Synthetic frontend-owned gate for the public backend reads mounted on static
 * pages. It exercises the real routes and validates their success event, so a
 * proxy returning HTML/another JSON envelope cannot produce a false green.
 */
export const probePublicDependencies = async (
  options: ProbeOptions = {}
): Promise<PublicDependencyHealth> => {
  const fetchImpl = options.fetchImpl ?? fetch;
  const now = options.now ?? Date.now;
  const timeoutMs = options.timeoutMs ?? 5_000;

  const [featureFlags, announcements, runtimeConfig] = await Promise.all([
    probeDependency(
      PUBLIC_DEPENDENCIES.featureFlags,
      fetchImpl,
      now,
      timeoutMs
    ),
    probeDependency(
      PUBLIC_DEPENDENCIES.announcements,
      fetchImpl,
      now,
      timeoutMs
    ),
    probeDependency(
      PUBLIC_DEPENDENCIES.runtimeConfig,
      fetchImpl,
      now,
      timeoutMs
    ),
  ]);

  const checks = { featureFlags, announcements, runtimeConfig };
  return {
    ok: Object.values(checks).every(check => check.ok),
    checks,
    checkedAt: new Date(now()).toISOString(),
  };
};
