import { describe, it, expect, vi, beforeEach } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';

// ---------------------------------------------------------------------------
// Ratchet for the haptic policy (owner, DECISION in
// `platform/haptic-events.config.ts`): the phone vibrates for a handful of
// confirmed outcomes and stays silent for everything frequent. A refactor that
// maps a fetch, a like or a sent message to a haptic, or that drops the photo
// success, breaks one of these.
// ---------------------------------------------------------------------------

const { hapticNotification } = vi.hoisted(() => ({
  hapticNotification: vi.fn(async (_kind: string) => undefined),
}));

vi.mock('../platform/haptics', () => ({ hapticNotification }));
vi.mock('../app-snackbar/appSnackbar.possibilities.api', () => ({
  pushNewSnackbar: vi.fn(() => undefined),
}));
vi.mock('../routing/redirections', () => ({
  redirectToAction: vi.fn(async () => undefined),
}));
vi.mock('../stores/user-cache', () => ({ resetUserSlice: vi.fn() }));
vi.mock('../http/queryClient.config', () => ({
  queryClient: { getQueryData: vi.fn(() => undefined) },
}));
vi.mock('../error-debugger/errorHandler.possibilities.api', () => ({
  reportIssueFrontend: vi.fn(),
}));

import { eventPipelineOrchestrator } from './eventPipeline.orchestrator';
import { HAPTIC_BY_EVENT } from '../platform/haptic-events.config';

describe('event pipeline: haptic stage', () => {
  beforeEach(() => {
    hapticNotification.mockClear();
  });

  it('vibrates once with Success when a work is published', async () => {
    await eventPipelineOrchestrator({
      event: APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED,
    });
    expect(hapticNotification).toHaveBeenCalledTimes(1);
    expect(hapticNotification).toHaveBeenCalledWith('Success');
  });

  it('vibrates with Success when a connection request is accepted', async () => {
    await eventPipelineOrchestrator({
      event: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_ACCEPTED,
    });
    expect(hapticNotification).toHaveBeenCalledWith('Success');
  });

  it('vibrates with Warning when the account is scheduled for deletion', async () => {
    await eventPipelineOrchestrator({
      event: APP_EVENTS.INFO.USER.USER_DELETED_SELF,
    });
    expect(hapticNotification).toHaveBeenCalledWith('Warning');
  });

  it('stays silent for frequent events: a fetch, a like, a session photo', async () => {
    for (const event of [
      APP_EVENTS.INFO.PAIRING.PAIRING_PAIRS_FETCHED,
      APP_EVENTS.INFO.FAVORITE.FAVORITE_GROUPED_FETCHED,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_ADDED,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_REMOVED,
      APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_NOTE_UPDATED,
    ]) {
      await eventPipelineOrchestrator({ event });
    }
    expect(hapticNotification).not.toHaveBeenCalled();
  });

  it('keeps the list short: outcomes, not interactions', () => {
    // Ten is a ceiling for a product of this size; a longer list is the old
    // „everything vibrates” coming back one event at a time.
    expect(Object.keys(HAPTIC_BY_EVENT).length).toBeLessThanOrEqual(10);
  });
});

describe('idempotent pairing haptics', () => {
  it('only vibrates when the request was newly created', async () => {
    hapticNotification.mockClear();
    for (const created of [undefined, false, 'true']) {
      await eventPipelineOrchestrator({
        event: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
        payload: { outcomeEvidence: { created } },
      });
    }
    expect(hapticNotification).not.toHaveBeenCalled();
    await eventPipelineOrchestrator({
      event: APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT,
      payload: { outcomeEvidence: { created: true } },
    });
    expect(hapticNotification).toHaveBeenCalledTimes(1);
  });
});
