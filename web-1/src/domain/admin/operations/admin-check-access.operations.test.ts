/**
 * checkAccessUrl_IO bounds the BODY, not only the headers (testy-api s34): the
 * timer used to be cleared on headers, so a slow drip held the request ~10 s,
 * and the whole body landed in the admin response.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SystemRoleId } from '@kernel/models/db_models.manual.dto';

import { checkAccessUrl_IO } from './admin-check-access.operations';

const admin = { role_id: SystemRoleId.MASTER_ADMIN } as never;

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe('checkAccessUrl_IO — bounded body', () => {
  it('caps a large body at 64 KiB', async () => {
    const big = 'x'.repeat(200 * 1024);
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(big, { status: 200 }))
    );

    const result = await checkAccessUrl_IO({
      url: 'https://httpbin.org/bytes/200000',
      currentUser: admin,
    });

    expect(result.success).toBe(true);
    if (result.success) {
      expect(String(result.data.data).length).toBe(64 * 1024);
    }
  });

  it('times out while the body is still dripping (the 5 s budget covers it)', async () => {
    vi.useFakeTimers();
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init: { signal: AbortSignal }) => {
        const stream = new ReadableStream<Uint8Array>({
          start(controller) {
            controller.enqueue(new TextEncoder().encode('a'));
            init.signal.addEventListener('abort', () =>
              controller.error(
                Object.assign(new Error('aborted'), { name: 'AbortError' })
              )
            );
          },
        });
        return new Response(stream, { status: 200 });
      })
    );

    const pending = checkAccessUrl_IO({
      url: 'https://httpbin.org/drip',
      currentUser: admin,
    });
    await vi.advanceTimersByTimeAsync(5_001);

    await expect(pending).resolves.toEqual({
      success: false,
      error: { type: 'CHECK_ACCESS_URL_NETWORK', reason: 'TIMEOUT' },
    });
  });
});
