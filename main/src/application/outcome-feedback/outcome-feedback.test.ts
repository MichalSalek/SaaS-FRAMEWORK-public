import { describe, expect, it } from 'vitest';
import { APP_EVENTS } from '@kernel/domain/events/app-events.const';
import {
  OUTCOME_MOMENTS,
  resolveOutcomeLevel,
  type OutcomeMoment,
} from './outcome-feedback.config';
import { resolveSaveFeedbackState } from './outcome-feedback.helpers';
import { shouldSuppressSuccessToast } from './success-feedback.policy';
import { resolveHapticOutcome } from '../platform/haptic-events.config';
describe('outcome policy', () => {
  it('covers all sixty accepted evidence IDs without duplicates', () => {
    expect(
      Object.values(OUTCOME_MOMENTS)
        .filter(value => value.id <= 60)
        .map(value => value.id)
        .sort((a, b) => a - b)
    ).toEqual(Array.from({ length: 60 }, (_, i) => i + 1));
  });
  it('never replays reads, pending results or unchanged responses', () => {
    for (const moment of Object.keys(OUTCOME_MOMENTS) as OutcomeMoment[]) {
      expect(
        resolveOutcomeLevel(moment, {
          confirmed: true,
          changed: true,
          source: 'read',
        })
      ).toBe('none');
      expect(
        resolveOutcomeLevel(moment, {
          confirmed: false,
          changed: true,
          source: 'action',
        })
      ).toBe('none');
      expect(
        resolveOutcomeLevel(moment, {
          confirmed: true,
          changed: false,
          source: 'action',
        })
      ).toBe('none');
      expect(
        resolveOutcomeLevel(moment, {
          confirmed: true,
          changed: true,
          source: 'action',
        })
      ).toBe(OUTCOME_MOMENTS[moment].level);
    }
  });
  it('only acknowledges the saved latest version', () => {
    expect(
      resolveSaveFeedbackState({
        pending: true,
        failed: true,
        dirty: true,
        acknowledged: true,
      })
    ).toBe('pending');
    expect(
      resolveSaveFeedbackState({
        pending: false,
        failed: true,
        dirty: true,
        acknowledged: true,
      })
    ).toBe('error');
    expect(
      resolveSaveFeedbackState({
        pending: false,
        failed: false,
        dirty: true,
        acknowledged: true,
      })
    ).toBe('dirty');
    expect(
      resolveSaveFeedbackState({
        pending: false,
        failed: false,
        dirty: false,
        acknowledged: true,
      })
    ).toBe('complete');
    expect(
      resolveSaveFeedbackState({
        pending: false,
        failed: false,
        dirty: false,
        acknowledged: false,
      })
    ).toBe('idle');
  });
  it('the moment registry suppresses only app-owned success, never admin or errors', () => {
    const event = APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_CREATED;
    expect(
      shouldSuppressSuccessToast(event, 'success', '/pl/app/sessions')
    ).toBe(true);
    expect(shouldSuppressSuccessToast(event, 'error', '/pl/app/sessions')).toBe(
      false
    );
    expect(
      shouldSuppressSuccessToast(event, 'success', '/pl/app/admin/users')
    ).toBe(false);
    expect(
      shouldSuppressSuccessToast(event, 'success', '/pl/salon/invite')
    ).toBe(false);
  });
  it('a declared screen or silent owner suppresses success on any path, admin included', () => {
    const event = APP_EVENTS.INFO.SUPPORT.SUPPORT_ADMIN_REPLIED;
    for (const owner of ['screen', 'silent'] as const) {
      expect(
        shouldSuppressSuccessToast(
          event,
          'success',
          '/pl/app/admin/support',
          owner
        )
      ).toBe(true);
      expect(
        shouldSuppressSuccessToast(
          event,
          'warning',
          '/pl/app/admin/support',
          owner
        )
      ).toBe(false);
    }
    expect(
      shouldSuppressSuccessToast(
        event,
        'success',
        '/pl/app/admin/support',
        'event'
      )
    ).toBe(false);
  });
  it('keeps a removed session photo quiet: the screen confirms it', () => {
    expect(
      shouldSuppressSuccessToast(
        APP_EVENTS.INFO.SESSION_CONTAINER.SESSION_CONTAINER_PHOTO_REMOVED,
        'success',
        '/pl/app/sessions'
      )
    ).toBe(true);
  });
  it('requires exact creation evidence only for a pair request', () => {
    const event = APP_EVENTS.INFO.PAIRING.PAIR_REQUEST_SENT;
    for (const created of [undefined, false, 'true', 1]) {
      expect(resolveHapticOutcome(event, { created })).toBeUndefined();
    }
    expect(resolveHapticOutcome(event, { created: true })).toBe('Success');
    expect(
      resolveHapticOutcome(APP_EVENTS.INFO.GALLERY.GALLERY_RECORD_CREATED)
    ).toBe('Success');
  });
});
