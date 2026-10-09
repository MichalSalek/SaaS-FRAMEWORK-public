// The error-feedback rule only works if every IO call carries the resolved
// policy to the interceptor: a query read (signal) goes 'background', an
// action or imperative read stays 'foreground', a declared policy wins.

import { beforeEach, describe, expect, it, vi } from 'vitest';

const { calls } = vi.hoisted(() => ({
  calls: [] as { errorFeedbackPolicy?: string; mode: string }[],
}));

vi.mock('./http.possibilities.api', () => ({
  callHTTPEndpoint: vi.fn(
    async ({
      config,
      successCallback,
    }: {
      config: { errorFeedbackPolicy?: string; mode: string };
      successCallback: (res: unknown) => Promise<void> | void;
    }) => {
      calls.push(config);
      await successCallback({ event: 'OK', data: {} });
    }
  ),
}));

import { defineEndpoint, defineQuery } from './io';

const url = () => '/x';

describe('IO calls carry the resolved error-feedback policy', () => {
  beforeEach(() => {
    calls.length = 0;
  });

  it('query reads with a signal are background, without one foreground', async () => {
    const read = defineQuery<{ a: string }, unknown>({
      url,
      queryFields: req => ({ a: req.a }),
    });
    await read({ a: '1' }, { signal: new AbortController().signal });
    await read({ a: '1' });
    expect(calls.map(c => c.errorFeedbackPolicy)).toEqual([
      'background',
      'foreground',
    ]);
  });

  it('actions stay foreground and a declared policy wins', async () => {
    const act = defineEndpoint<object, unknown>({ url, mode: 'post' });
    const declared = defineEndpoint<object, unknown>({
      url,
      mode: 'get',
      errorFeedbackPolicy: 'foreground',
    });
    await act({}, { signal: new AbortController().signal });
    await declared({}, { signal: new AbortController().signal });
    expect(calls.map(c => c.errorFeedbackPolicy)).toEqual([
      'foreground',
      'foreground',
    ]);
  });
});
