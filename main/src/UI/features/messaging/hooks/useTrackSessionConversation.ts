import { useEffect, useRef } from 'react';
import { useRouter } from 'next/router';
import type { MessagingThreadMeta } from '@kernel/models/messaging/messaging.dto';
import { trackFlowStep } from '../../../../application/analytics/flow-events';

/** Count a successful arrival, after the owned thread loads, once per visit. */
export function useTrackSessionConversation(
  pairId: string,
  meta: MessagingThreadMeta | null
): void {
  const { query } = useRouter();
  const tracked = useRef<string | null>(null);
  const loadedPair = meta?.pair_id;
  const side = meta?.viewer_side;
  const fromSession = query.fromSession === '1';
  useEffect(() => {
    if (
      !fromSession ||
      !pairId ||
      loadedPair !== pairId ||
      tracked.current === pairId
    ) {
      return;
    }
    tracked.current = pairId;
    trackFlowStep('session', 'conversation_opened', {
      role: side,
      measurement_version: 1,
    });
  }, [fromSession, pairId, loadedPair, side]);
}
