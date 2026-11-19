// @vitest-environment node
import { readFileSync } from 'node:fs';
import { runInNewContext } from 'node:vm';
import { MessageChannel } from 'node:worker_threads';
import { describe, expect, it, vi } from 'vitest';

const origin = 'https://nailfolio.example';
const source = readFileSync(
  new URL('../../../../public/sw.js', import.meta.url),
  'utf8'
);

type NotificationClick = {
  notification: { data: { url: string }; close: () => void };
  waitUntil: (promise: Promise<unknown>) => void;
};

function setup(pages: object[]) {
  const handlers = new Map<string, (event: NotificationClick) => void>();
  const openWindow = vi.fn(async (url: string) => ({ url }));
  const self = {
    location: { origin },
    clients: { matchAll: vi.fn(async () => pages), openWindow, claim: vi.fn() },
    registration: {},
    addEventListener: (
      type: string,
      handler: (event: NotificationClick) => void
    ) => handlers.set(type, handler),
  };
  runInNewContext(source, {
    self,
    URL,
    MessageChannel,
    setTimeout,
    clearTimeout,
  });
  const click = async (url: string) => {
    let pending: Promise<unknown> | undefined;
    const close = vi.fn();
    const handler = handlers.get('notificationclick');
    if (!handler) {
      throw new Error('Notification click handler is missing');
    }
    handler({
      notification: { data: { url }, close },
      waitUntil: (promise: Promise<unknown>) => {
        pending = promise;
      },
    });
    await pending;
    expect(close).toHaveBeenCalledOnce();
  };
  return { click, openWindow };
}

describe('service worker notification tap', () => {
  it('opens the query-bearing app target when only a public page exists', async () => {
    const publicPage = {
      url: `${origin}/pricing`,
      focus: vi.fn(),
      postMessage: vi.fn(),
    };
    const { click, openWindow } = setup([publicPage]);
    await click('/app/notifications/open?id=ntf_1');
    expect(publicPage.focus).not.toHaveBeenCalled();
    expect(publicPage.postMessage).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(
      `${origin}/app/notifications/open?id=ntf_1`
    );
  });

  it('does not send a tap to about:blank or a foreign-origin app client', async () => {
    const blank = { url: 'about:blank', focus: vi.fn(), postMessage: vi.fn() };
    const foreign = {
      url: 'https://evil.example/app',
      focus: vi.fn(),
      postMessage: vi.fn(),
    };
    const { click, openWindow } = setup([blank, foreign]);
    await click('/app/notifications/open?id=ntf_1');
    expect(blank.postMessage).not.toHaveBeenCalled();
    expect(foreign.postMessage).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(
      `${origin}/app/notifications/open?id=ntf_1`
    );
  });

  it('delivers to a localized app client and focuses only after acknowledgment', async () => {
    const app = {
      url: `${origin}/de/app/account`,
      focus: vi.fn(async () => app),
      postMessage: vi.fn((message, ports) => {
        if (message.type === 'nf-push-probe') {
          ports[0].postMessage({ type: 'nf-push-ready' });
        }
      }),
    };
    const { click, openWindow } = setup([app]);
    await click('/app/notifications/open?id=ntf_1');
    expect(app.postMessage.mock.calls[0]?.[0]).toEqual({
      type: 'nf-push-probe',
    });
    expect(app.postMessage.mock.calls[1]?.[0]).toEqual({
      type: 'nf-push-open',
      url: `${origin}/app/notifications/open?id=ntf_1`,
    });
    expect(Array.isArray(app.postMessage.mock.calls[0]?.[1])).toBe(true);
    expect(app.focus).toHaveBeenCalledOnce();
    expect(openWindow).not.toHaveBeenCalled();
  });

  it('opens another window when an app has no listener, without navigating that app', async () => {
    const app = {
      url: `${origin}/en/app/account`,
      focus: vi.fn(),
      postMessage: vi.fn(),
      navigate: vi.fn(),
    };
    const { click, openWindow } = setup([app]);
    await click('/app/notifications/open?id=ntf_1');
    expect(app.navigate).not.toHaveBeenCalled();
    expect(app.focus).not.toHaveBeenCalled();
    expect(openWindow).toHaveBeenCalledWith(
      `${origin}/app/notifications/open?id=ntf_1`
    );
  });

  it('does not send an open request after a readiness reply arrives too late', async () => {
    const app = {
      url: `${origin}/app/account`,
      focus: vi.fn(),
      postMessage: vi.fn((_message, ports) => {
        setTimeout(() => ports[0].postMessage({ type: 'nf-push-ready' }), 1050);
      }),
    };
    const { click, openWindow } = setup([app]);
    await click('/app/notifications/open?id=ntf_1');
    await new Promise(resolve => setTimeout(resolve, 100));
    expect(app.postMessage).toHaveBeenCalledOnce();
    expect(app.postMessage.mock.calls[0]?.[0]).toEqual({
      type: 'nf-push-probe',
    });
    expect(openWindow).toHaveBeenCalledOnce();
    expect(app.focus).not.toHaveBeenCalled();
  });

  it('rejects external and non-app targets', async () => {
    const { click, openWindow } = setup([]);
    await click('https://evil.example/app');
    await click('/pricing');
    expect(openWindow).toHaveBeenNthCalledWith(
      1,
      `${origin}/app/notifications`
    );
    expect(openWindow).toHaveBeenNthCalledWith(
      2,
      `${origin}/app/notifications`
    );
  });
});
