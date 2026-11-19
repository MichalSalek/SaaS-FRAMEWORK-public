// UI/features/shared/sessions/hooks/sessionFlowTrace.ts
// Flow trace helpers for the inspiration session (`session` flow in
// application/analytics/flow-events.ts). Failures carry the action and the
// API event name only, never what the person typed.

import { trackFlowStep } from '../../../../../application/analytics/flow-events';
import { flowErrorCode } from '../../analytics/flowErrorCode';

export type SessionFlowAction =
  'create' | 'add_photo' | 'remove_photo' | 'note' | 'share' | 'close';

/** Where a photo entered or left a session. */
export type SessionPhotoOrigin =
  'gallery_picker' | 'photo_detail' | 'session_screen';

export function trackSessionFailed(
  action: SessionFlowAction,
  error: unknown
): void {
  trackFlowStep('session', 'failed', { action, code: flowErrorCode(error) });
}
