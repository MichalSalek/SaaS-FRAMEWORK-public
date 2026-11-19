// UI/features/sessions/hooks/useTrackSessionOpened.ts
// Flow trace `session_opened_by_stylist`: once per visit of the stylist's
// session screen, when the session has loaded. The ref keeps a refetch, a
// re-render or a StrictMode double effect from counting the same visit twice.

import { useEffect, useRef } from 'react';
import type { SessionContainerDetailDTO } from '@kernel/models/session-container/session-container.dto';
import { trackFlowStep } from '../../../../application/analytics/flow-events';

export function useTrackSessionOpened(
  sessionId: string,
  session: SessionContainerDetailDTO | undefined,
  role: 'client' | 'stylist' = 'stylist'
): void {
  const trackedRef = useRef<string | null>(null);
  const loaded = session !== undefined;
  useEffect(() => {
    if (!loaded || trackedRef.current === sessionId) {
      return;
    }
    trackedRef.current = sessionId;
    trackFlowStep('session', 'opened', { role, measurement_version: 1 });
    if (role === 'stylist') {
      trackFlowStep('session', 'opened_by_stylist');
    }
  }, [loaded, sessionId, role]);
}
