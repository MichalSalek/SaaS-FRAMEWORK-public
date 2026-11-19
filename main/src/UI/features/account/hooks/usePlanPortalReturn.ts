import { useCheckoutPortalResume } from './useCheckoutPortalResume';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import { useCurrentUserAccount } from '../../../shared/hooks/useCurrentUserAccount';
import { resolvePlanStatusSummary } from '../AccountPayPage.helpers';
import { trackFlowStep } from '../../../../application/analytics/flow-events';

const RETURN_POLL_MS = 1_500;
const RETURN_WAIT_MS = 12_000;
type ReturnStatus = {
  marker: string;
  attempt: number;
  outcome: 'done' | 'timeout';
  updatedAt: number;
};

/** A return marker is intent, never proof that Stripe changed the plan. */
export function usePlanPortalReturn() {
  const resume = useCheckoutPortalResume();
  const router = useRouter();
  const account = useCurrentUserAccount();
  const marker = router.query['portal'];
  const returned = marker === 'canceled' || marker === 'back';
  const [status, setStatus] = useState<ReturnStatus | null>(null);
  const [attempt, setAttempt] = useState(0);
  const { refetch } = account;
  // One trace per arrival with a marker (a retry or StrictMode re-run is not a return).
  const trackedMarker = useRef<string | null>(null);
  useEffect(() => {
    if (!returned) {
      return;
    }
    if (trackedMarker.current !== marker) {
      trackedMarker.current = marker;
      trackFlowStep('checkout', 'portal_returned', { marker });
    }
    let disposed = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const deadline = Date.now() + RETURN_WAIT_MS;
    const timeout = setTimeout(() => {
      disposed = true;
      if (timer !== undefined) {
        clearTimeout(timer);
      }
      setStatus({ marker, attempt, outcome: 'timeout', updatedAt: Date.now() });
    }, RETURN_WAIT_MS);
    const refresh = async () => {
      const result = await refetch();
      if (disposed) {
        return;
      }
      const stylist = result.data?.stylist_account;
      const kind =
        stylist != null ? resolvePlanStatusSummary(stylist).kind : null;
      const confirmed =
        !result.isError &&
        stylist != null &&
        (marker === 'back' || kind === 'canceling' || kind === 'free');
      if (confirmed || Date.now() >= deadline || result.isError) {
        clearTimeout(timeout);
        setStatus({
          marker,
          attempt,
          outcome: confirmed ? 'done' : 'timeout',
          updatedAt: result.dataUpdatedAt,
        });
      } else {
        timer = setTimeout(() => void refresh(), RETURN_POLL_MS);
      }
    };
    void refresh();
    return () => {
      disposed = true;
      clearTimeout(timeout);
      if (timer !== undefined) {
        clearTimeout(timer);
      }
    };
  }, [returned, marker, refetch, attempt]);

  const latest =
    status !== null && status.marker === marker && status.attempt === attempt
      ? status
      : null;
  const stylist = account.data?.stylist_account;
  const kind = stylist != null ? resolvePlanStatusSummary(stylist).kind : null;
  // A subsequent successful read can settle a webhook that arrived after the window.
  const resolvedLate =
    latest?.outcome === 'timeout' &&
    !account.isError &&
    account.dataUpdatedAt > latest.updatedAt &&
    stylist != null &&
    (marker === 'back' || kind === 'canceling' || kind === 'free');
  return {
    waiting: resume.waiting || (returned && latest === null),
    timedOut:
      resume.failed ||
      (returned && latest?.outcome === 'timeout' && !resolvedLate),
    returned,
    retry: () => {
      resume.retry();
      setAttempt(value => value + 1);
    },
  };
}
