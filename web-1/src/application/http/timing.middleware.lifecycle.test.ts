/**
 * (Sibling file: timing.middleware.test.ts pins x-request-id correlation on the
 * node-mocks-http harness. This one is SEPARATE on purpose — it needs a real
 * node:http server, and the two harnesses must not be tangled in one file.)
 *
 * Timing middleware — THE FAST PATH MUST ALSO SEE ABORTED REQUESTS.
 *
 * `withTimingNextHandlerMiddleware` has two branches. The verbose one (admin
 * toggle ON) always listened on both `finish` and `close`. The fast one — the
 * DEFAULT, i.e. what production actually runs — listened only on `finish`.
 *
 * A request the client aborts (closed tab, cancelled fetch, mobile-network
 * timeout) never emits `finish`, so it produced NO timing sample at all. That is
 * worse than a gap: aborts skew long, so the health dashboard was silently
 * dropping its own tail and reporting the service as faster the worse it got.
 *
 * Both halves are pinned here, because the fix has an obvious failure mode of its
 * own: `close` fires after `finish` on every ordinary response, so adding the
 * listener without a guard would DOUBLE-COUNT every single request.
 *
 * HARNESS (load-bearing — do NOT "simplify" this back to node-mocks-http):
 * this is the one contract in the file that lives entirely in `res` lifecycle
 * EVENTS, and `node-mocks-http`'s mock response accepts `.once(...)` as a NO-OP —
 * a listener registered on it is never invoked, so the whole suite would pass
 * green against a middleware that registers nothing at all. We therefore drive a
 * REAL `node:http` server: `finish` and `close` come from Node itself, and the
 * abort case is a genuine socket destroy from a real client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import http from 'node:http';
import type { AddressInfo } from 'node:net';
import type { NextApiHandler, NextApiRequest, NextApiResponse } from 'next';

vi.mock('@app/health/request-timing.buffer', () => ({
  recordRequestTiming: vi.fn(),
}));

import { recordRequestTiming } from '@app/health/request-timing.buffer';
import { debuggerStates } from '@app/debugger/debugger.state';
import { withTimingNextHandlerMiddleware } from './timing.middleware';

const recorded = vi.mocked(recordRequestTiming);

let server: http.Server;
let baseUrl: string;

/** Resolves once the wrapped middleware has recorded a sample (or times out). */
const waitForSample = async (timeoutMs = 1000): Promise<void> => {
  const deadline = Date.now() + timeoutMs;
  while (recorded.mock.calls.length === 0 && Date.now() < deadline) {
    await new Promise(resolve => setTimeout(resolve, 5));
  }
};

const startServer = async (handler: NextApiHandler): Promise<void> => {
  const wrapped = withTimingNextHandlerMiddleware(handler);
  server = http.createServer((req, res) => {
    void wrapped(req as NextApiRequest, res as unknown as NextApiResponse);
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as AddressInfo;
  baseUrl = `http://127.0.0.1:${port}/api/v1/test`;
};

beforeEach(() => {
  recorded.mockClear();
  // Pin the FAST path (verbose timing debugger off) — that is the branch under test.
  debuggerStates.isEnabledApiTimingDebugger = false;
});

afterEach(async () => {
  await new Promise<void>(resolve => {
    server.close(() => resolve());
  });
});

describe('withTimingNextHandlerMiddleware — fast path', () => {
  it('records a sample for a request the client aborted mid-flight', async () => {
    // Handler deliberately never responds: the only lifecycle event this request
    // will ever produce is `close`, exactly like a real abandoned request.
    await startServer(async () => new Promise(() => undefined));

    const controller = new AbortController();
    const inflight = fetch(baseUrl, { signal: controller.signal }).catch(
      () => undefined
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    controller.abort();
    await inflight;

    await waitForSample();
    expect(recorded).toHaveBeenCalledTimes(1);
  });

  it('records exactly one sample for an ordinary response (finish AND close both fire)', async () => {
    // A raw `node:http` ServerResponse has no Next `.status()/.json()` sugar
    // (Next adds it) — and this test needs the REAL object precisely because the
    // contract under test is its event lifecycle. Respond with node primitives.
    await startServer(async (_req, res) => {
      const raw = res as unknown as http.ServerResponse;
      raw.writeHead(200, { 'Content-Type': 'application/json' });
      raw.end('{"ok":true}');
    });

    await (await fetch(baseUrl)).text();

    await waitForSample();
    // Give `close` (which follows `finish`) a chance to double-count if unguarded.
    await new Promise(resolve => setTimeout(resolve, 50));
    expect(recorded).toHaveBeenCalledTimes(1);
  });
});
