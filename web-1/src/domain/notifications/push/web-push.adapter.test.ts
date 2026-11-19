import { beforeEach, expect, it, vi } from 'vitest';
import { sendWebPush } from './web-push.adapter';
import { Agent } from 'node:https';

const delivery = vi.hoisted(() => ({ send: vi.fn() }));
vi.mock('web-push', () => ({
  default: { setVapidDetails: vi.fn(), sendNotification: delivery.send },
  WebPushError: class extends Error {},
}));
vi.mock('./push.config', () => ({
  getWebPushConfig: () => ({
    subject: 'mailto:qa@example.test',
    publicKey: 'test-public-key',
    privateKey: 'test-private-key',
  }),
}));
vi.mock('@app/debugger/error-handler', () => ({ reportIssueBackend: vi.fn() }));

beforeEach(() => delivery.send.mockReset().mockResolvedValue(undefined));

it('replaces only retries of the same logical activity, not groups sharing a long prefix', async () => {
  const subscription = {
    endpoint: 'https://push.example.test/device',
    p256dh: 'test-p256dh',
    auth: 'test-auth',
  };
  const first =
    'SESSION_CHANGED:cmw5gmtdn00ng3xobk4zo2i4g:2026-11-06T21:06:16.368Z';
  const later =
    'SESSION_CHANGED:cmw5gmtdn00ng3xobk4zo2i4g:2026-11-06T21:09:46.903Z';
  for (const tag of [first, first, later]) {
    expect(
      await sendWebPush(subscription, {
        title: 'Changed',
        body: 'Open inspirations',
        tag,
        url: '/app/notifications/open?id=qa',
        notificationId: 'qa',
      })
    ).toBe('sent');
  }
  const topics = delivery.send.mock.calls.map(call => call[2].topic as string);
  expect(delivery.send.mock.calls[0]?.[2].agent).toBeInstanceOf(Agent);
  expect(topics[0]).toBe(topics[1]);
  expect(topics[2]).not.toBe(topics[0]);
  for (const topic of topics) {
    expect(topic).toMatch(/^[A-Za-z0-9_-]{1,32}$/);
  }
  expect(JSON.parse(delivery.send.mock.calls.at(-1)?.[1] ?? '').tag).toBe(
    later
  );
});
