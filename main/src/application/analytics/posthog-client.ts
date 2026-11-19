// application/analytics/posthog-client.ts
//
// DECISION: `posthog-js` is reached ONLY through this module (mobile TBT on public pages). A static
// `import posthog from 'posthog-js'` anywhere in the `_app` graph puts the whole library (~316 KB
// minified) into the `_app` chunk, parsed before hydration although `PostHogProvider` initialises it
// seconds later. The library is a separate chunk loaded by `loadPosthogLibrary()` when the provider
// starts it.
//
// Calls made before that moment are QUEUED, not dropped: `posthog.capture` before `init` returns
// with an "uninitialized" warning and loses the event. A queued capture keeps its `timestamp`. The
// queue is bounded and never flushes when PostHog never starts (own traffic, no key), which is
// exactly when nothing may be sent.

import type { CaptureOptions, PostHog, Properties } from 'posthog-js';

type PosthogTask = (posthog: PostHog) => void;

/** Enough for a long first minute on a slow phone; later calls are dropped. */
const MAX_QUEUED_TASKS = 200;

let client: PostHog | null = null;
const queue: PosthogTask[] = [];

const runSafely = (posthog: PostHog, task: PosthogTask): void => {
  try {
    task(posthog);
  } catch {
    // Analytics is best effort and must never interrupt the page.
  }
};

/** The library chunk; the same module instance for every caller. */
export async function loadPosthogLibrary(): Promise<PostHog> {
  const { default: posthog } = await import('posthog-js');
  return posthog;
}

/** Called once `init` has finished (`loaded`); runs everything queued. */
export function attachPosthog(posthog: PostHog): void {
  client = posthog;
  const pending = queue.splice(0, queue.length);
  for (const task of pending) {
    runSafely(posthog, task);
  }
}

/** The initialised instance, or `null` while PostHog has not started. */
export function getPosthog(): PostHog | null {
  return client;
}

/** Runs `task` now when PostHog is ready, otherwise once it is. */
export function withPosthog(task: PosthogTask): void {
  if (client !== null) {
    runSafely(client, task);
    return;
  }
  if (queue.length < MAX_QUEUED_TASKS) {
    queue.push(task);
  }
}

/** `posthog.capture` that survives being called before `init`. */
export function capturePosthog(
  name: string,
  properties?: Properties,
  captureOptions?: CaptureOptions
): void {
  if (client !== null) {
    runSafely(client, posthog =>
      captureOptions
        ? posthog.capture(name, properties, captureOptions)
        : posthog.capture(name, properties)
    );
    return;
  }
  // The page it happened on, too: an in-app navigation may come before init,
  // and PostHog would stamp the event with the address at send time.
  const queued: Properties = {
    $current_url: window.location.href,
    $pathname: window.location.pathname,
    ...properties,
  };
  const options: CaptureOptions = { timestamp: new Date(), ...captureOptions };
  withPosthog(posthog => posthog.capture(name, queued, options));
}

/** Test seam: forget the instance and the queue. */
export function resetPosthogClientForTests(): void {
  client = null;
  queue.length = 0;
}
