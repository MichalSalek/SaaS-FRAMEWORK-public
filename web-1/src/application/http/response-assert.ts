import type { EVENT_INFO_TYPE } from '@kernel/domain/commands-and-queries/cqrs.types';
import { EVENTS_POLICY } from '@kernel/policies/events.policy';
import { ENV_VARS } from '@app/environment/environment.config';
import { reportIssueBackend } from '@app/debugger/error-handler';

export function assertResponseShape(
  event: EVENT_INFO_TYPE,
  _data: unknown
): void {
  if (
    ENV_VARS.NODE_ENV_MANUAL === 'PRODUCTION' ||
    ENV_VARS.NODE_ENV_MANUAL === 'PREVIEW'
  ) {
    return;
  }

  if (!EVENTS_POLICY.utils.IS_INFO_EVENT(event)) {
    reportIssueBackend({
      namespace: 'response-assert',
      message: `Unknown event in response: "${event}"`,
      payload: { event },
      mode: 'warn',
    });
  }
}
