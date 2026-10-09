import { describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  probePublicDependencies,
  type PublicDependencyFetch,
  verifySyntheticMonitorSecret,
} from './public-dependency-monitor';

type ResponseDefinition = {
  status: number;
  event: string;
};

const successResponses: Record<string, ResponseDefinition> = {
  'feature-flags': {
    status: 200,
    event: APP_EVENTS.INFO.ADMIN.FEATURE_FLAGS_FETCHED,
  },
  'announcements/active': {
    status: 200,
    event: APP_EVENTS.INFO.APPLICATION.ACTIVE_ANNOUNCEMENTS_FETCHED,
  },
  'runtime-config': {
    status: 200,
    event: APP_EVENTS.INFO.APPLICATION.PUBLIC_RUNTIME_CONFIG_FETCHED,
  },
};

const responseForUrl = (
  url: string,
  responses: Record<string, ResponseDefinition>
): ResponseDefinition => {
  const match = Object.entries(responses).find(([path]) => url.includes(path));
  if (!match) {
    throw new Error(`Unexpected dependency URL: ${url}`);
  }
  return match[1];
};

const makeFetch =
  (
    responses: Record<string, ResponseDefinition> = successResponses
  ): PublicDependencyFetch =>
  async url => {
    const response = responseForUrl(url, responses);
    return Response.json(
      { event: response.event, data: {} },
      { status: response.status }
    );
  };

describe('probePublicDependencies', () => {
  it('returns a green 3/3 gate only for the expected success envelopes', async () => {
    const result = await probePublicDependencies({
      fetchImpl: makeFetch(),
      now: () => 1_000,
    });

    expect(result.ok).toBe(true);
    expect(result.checks).toEqual({
      featureFlags: { ok: true, status: 200, durationMs: 0 },
      announcements: { ok: true, status: 200, durationMs: 0 },
      runtimeConfig: { ok: true, status: 200, durationMs: 0 },
    });
  });

  it('fails the aggregate when a dependency returns HTTP 500', async () => {
    const result = await probePublicDependencies({
      fetchImpl: makeFetch({
        ...successResponses,
        'announcements/active': {
          status: 500,
          event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.announcements).toMatchObject({
      ok: false,
      status: 500,
    });
  });

  it('fails a 200 response carrying the wrong event instead of reporting false green', async () => {
    const result = await probePublicDependencies({
      fetchImpl: makeFetch({
        ...successResponses,
        'runtime-config': {
          status: 200,
          event: APP_EVENTS.INFO.APPLICATION.GENERAL_ERROR,
        },
      }),
    });

    expect(result.ok).toBe(false);
    expect(result.checks.runtimeConfig).toMatchObject({
      ok: false,
      status: 200,
    });
  });

  it('maps a network/timeout rejection to status 0 without throwing the monitor route', async () => {
    const fetchImpl: PublicDependencyFetch = async url => {
      if (url.includes('feature-flags')) {
        throw new TypeError('fetch failed');
      }
      const response = responseForUrl(url, successResponses);
      return Response.json(
        { event: response.event, data: {} },
        { status: response.status }
      );
    };

    const result = await probePublicDependencies({ fetchImpl });

    expect(result.ok).toBe(false);
    expect(result.checks.featureFlags).toMatchObject({ ok: false, status: 0 });
  });
});

describe('verifySyntheticMonitorSecret', () => {
  it('accepts only an exact scalar secret match', () => {
    expect(verifySyntheticMonitorSecret('secret-value', 'secret-value')).toBe(
      true
    );
    expect(verifySyntheticMonitorSecret('secret-value', 'wrong-value')).toBe(
      false
    );
    expect(verifySyntheticMonitorSecret(undefined, 'secret-value')).toBe(false);
    expect(verifySyntheticMonitorSecret('secret-value', undefined)).toBe(false);
    expect(
      verifySyntheticMonitorSecret('secret-value', [
        'secret-value',
        'duplicate',
      ])
    ).toBe(false);
  });
});
