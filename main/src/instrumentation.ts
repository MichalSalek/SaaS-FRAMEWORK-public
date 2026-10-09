export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs') {
    await import('./application/environment/environment.config');
  }
}

// Next.js native hook — łapie UNCAUGHT errory serwera SSR (getServerSideProps /
// render pages, których nie widzi ani klient posthog-js, ani ErrorBoundary klienta).
// `main` NIE ma funnela reportIssueBackend (to backend web-1), więc onRequestError jest
// tu właściwym i JEDYNYM serwerowym punktem capture — zero podwójnego zliczania.
// No-op poza nodejs / bez klucza PostHog (guard w getPostHogServer).
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

  // distinct_id z ciasteczka PostHog (ph_<phc_key>_posthog) — spina błąd serwera z
  // sesją usera w Error Tracking. Best-effort; brak / malformed = anonimowo.
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
        // malformed cookie — anonimowo
      }
    }
  }

  const error =
    err instanceof Error
      ? err
      : new Error(typeof err === 'string' ? err : String(err));
  // Best-effort, never-throw: capture + flush() mogą odrzucić przy błędzie sieci.
  // onRequestError jest sam handlerem błędów — rzut stąd = error-in-error-handler
  // (szum, potencjalny unhandled rejection). Połknij (parytet z never-throw
  // flushPostHogServer w web-1). flushAt:1 wysyła od razu, ale flush() gwarantuje
  // wyjście eventu zanim proces ewentualnie ubity (redeploy tuż po błędzie).
  try {
    posthog.captureException(error, distinctId);
    await posthog.flush();
  } catch {
    // reporting best-effort — nie może wywalić serwerowego error-hooka
  }
};
