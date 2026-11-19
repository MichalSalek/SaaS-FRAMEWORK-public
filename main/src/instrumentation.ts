export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./application/environment/environment.config');
  }
}

// Next.js native hook: catches UNCAUGHT SSR server errors (getServerSideProps / page render) that
// neither the posthog-js client nor the client ErrorBoundary sees. `main` has no reportIssueBackend
// funnel (that is the web-1 backend), so onRequestError is the one server-side capture point and
// nothing is counted twice. No-op outside nodejs or without a PostHog key (guard in
// getPostHogServer).
export const onRequestError = async (
  err: unknown,
  request: { headers?: Record<string, string | string[] | undefined> }
): Promise<void> => {
  if (process.env.NEXT_RUNTIME !== 'nodejs') {
    return;
  }
  const { getPostHogServer } =
    await import('./application/analytics/posthog-server');
  const posthog = getPostHogServer();
  if (!posthog) {
    return;
  }

  // distinct_id from the PostHog cookie (ph_<phc_key>_posthog) ties the server error to the user's
  // session in Error Tracking. Best-effort; missing or malformed = anonymous.
  let distinctId: string | undefined;
  const rawCookie = request?.headers?.cookie;
  const cookieString = Array.isArray(rawCookie)
    ? rawCookie.join('; ')
    : rawCookie;
  if (cookieString) {
    const match = cookieString.match(/ph_phc_.*?_posthog=([^;]+)/);
    if (match?.[1]) {
      try {
        const parsed = JSON.parse(decodeURIComponent(match[1])) as {
          distinct_id?: string;
        };
        distinctId = parsed.distinct_id;
      } catch {
        // malformed cookie: anonymous
      }
    }
  }

  const error =
    err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : String(err));
  // Best-effort, never-throw: capture + flush() can reject on a network error. onRequestError is
  // itself an error handler, so a throw here is an error in the error handler (noise, possible
  // unhandled rejection); swallow it (parity with the never-throw flushPostHogServer in web-1).
  // flushAt:1 sends at once, but flush() guarantees the event leaves before the process may be
  // killed (a redeploy right after the error).
  try {
    posthog.captureException(error, distinctId);
    await posthog.flush();
  } catch {
    // best-effort reporting must not crash the server error hook
  }
};
