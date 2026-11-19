// The profile-view counter is fire-and-forget (StylistProfilePage swallows the rejection), so it
// declares the background error policy: a failure, 503 AUTH_UNAVAILABLE included, never toasts.

import { describe, expect, it, vi } from 'vitest';

const { calls } = vi.hoisted(() => ({
  calls: [] as { errorFeedbackPolicy?: string; mode: string }[],
}));

vi.mock('../../application/http/http.possibilities.api', () => ({
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

import { incrementProfileView_IO } from './accountIO.possibilities.api';

describe('incrementProfileView_IO', () => {
  it('is a background call, so no failure of the counter toasts', async () => {
    await incrementProfileView_IO({ stylist_account_id: 'acc_1' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toMatchObject({
      mode: 'post',
      errorFeedbackPolicy: 'background',
    });
  });
});
