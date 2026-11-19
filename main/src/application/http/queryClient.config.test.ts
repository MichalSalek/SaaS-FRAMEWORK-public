// Global mutation-error fallback (warstwa 3): fires only for failures the HTTP
// interceptor never saw. An IOError already had its feedback decided there.

import { afterEach, describe, expect, it, vi } from 'vitest';
import { MutationObserver } from '@tanstack/react-query';
import {
  queryClient,
  registerGlobalMutationErrorHandler,
} from './queryClient.config';

const ioError = (): Error =>
  Object.assign(new Error('INTERNET_CONNECTION_PROBLEM'), {
    httpError: { event: 'INTERNET_CONNECTION_PROBLEM', data: undefined },
  });

async function runFailingMutation(
  error: Error,
  meta?: Record<string, unknown>
): Promise<void> {
  const observer = new MutationObserver(queryClient, {
    mutationFn: () => Promise.reject(error),
    ...(meta ? { meta } : {}),
  });
  await observer.mutate().catch(() => undefined);
}

describe('global mutation error fallback', () => {
  afterEach(() => {
    queryClient.getMutationCache().clear();
  });

  it('stays silent for an IOError (the interceptor owns that toast)', async () => {
    const handler = vi.fn();
    registerGlobalMutationErrorHandler(handler);
    await runFailingMutation(ioError());
    expect(handler).not.toHaveBeenCalled();
  });

  it('fires for a client-side throw the interceptor never saw', async () => {
    const handler = vi.fn();
    registerGlobalMutationErrorHandler(handler);
    await runFailingMutation(new Error('stripe confirm failed'));
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('respects meta.suppressGlobalError', async () => {
    const handler = vi.fn();
    registerGlobalMutationErrorHandler(handler);
    await runFailingMutation(new Error('handled locally'), {
      suppressGlobalError: true,
    });
    expect(handler).not.toHaveBeenCalled();
  });
});
