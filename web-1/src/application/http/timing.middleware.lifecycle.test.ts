/**
 * Timing middleware: the FAST path must also see aborted requests.
 *
 * `withTimingNextHandlerMiddleware` has a verbose branch (admin toggle ON, listens on `finish`
 * and `close`) and a fast one (the default in production). A client-aborted request never emits
 * `finish`, so a `finish`-only fast path drops aborts, which skew long, and under-reports
 * latency. Both halves are pinned: aborts are sampled, and `close` firing after `finish` on an
 * ordinary response must not DOUBLE-COUNT.
 *
 * HARNESS (do not "simplify" to node-mocks-http): its mock response accepts `.once(...)` as a
 * no-op, so a middleware registering nothing would pass. This drives a REAL `node:http` server;
 * the abort is a genuine socket destroy. Sibling timing.middleware.test.ts uses the mock harness.
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
