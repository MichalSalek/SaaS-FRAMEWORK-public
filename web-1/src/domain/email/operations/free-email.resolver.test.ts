import { describe, expect, it } from 'vitest';
import { TIME } from '@kernel/application/constants.config';
import {
  resolveFreeEmail,
  freeExistingOffsetDays,
  type FreeEmailState,
  type FreeEmailHistory,
} from './free-email.resolver';
const start = new Date('2026-10-01T12:00:00Z');
const at = (days: number) => new Date(start.getTime() + days * TIME.MS_PER_DAY);
const enrollment = {
  id: 'enrollment',
  accountId: 'account',
  cohort: 'new',
  status: 'active',
  startedAt: start,
};
const state: FreeEmailState = {
  active: true,
  effectiveFree: true,
  hasTrialHistory: false,
  hasPaidHistory: false,
  checkoutActive: false,
  tipsEnabled: true,
  deliveryBlocked: false,
  excluded: false,
  visiblePhotoCount: 0,
  visiblePinnedCount: 0,
  acceptedPairCount: 0,
  pendingPairCount: 0,
};
const resolve = (
  days: number,
  patch: Partial<FreeEmailState> = {},
  history: FreeEmailHistory[] = []
) => resolveFreeEmail(enrollment, { ...state, ...patch }, history, at(days));
describe('Free onboarding opportunities', () => {
  it('opens exactly at 24 hours and closes its first window at 72 hours', () => {
    expect(resolve(1 - 1 / TIME.MS_PER_DAY)).toMatchObject({
      kind: 'skip',
      reason: 'not_due',
    });
    expect(resolve(1)).toMatchObject({
      kind: 'send',
      opportunityId: 'd1',
      templateId: 'free-first-photo',
    });
    expect(resolve(3)).toMatchObject({ kind: 'skip', reason: 'not_due' });
  });
  it('opens the second and third opportunities at days four and nine', () => {
    expect(resolve(4)).toMatchObject({ kind: 'send', opportunityId: 'd4' });
    expect(resolve(6)).toMatchObject({ kind: 'skip', reason: 'not_due' });
    expect(resolve(9)).toMatchObject({ kind: 'send', opportunityId: 'd9' });
    expect(resolve(11)).toEqual({ kind: 'finish', reason: 'expired' });
  });
  it('does not repeat a step or jump to the next unfinished step', () => {
    const history = [
      { templateId: 'free-first-photo', opportunityId: 'd1', at: at(1) },
    ];
    expect(resolve(4, {}, history)).toMatchObject({
      kind: 'skip',
      reason: 'step_already_reminded',
    });
    expect(resolve(4, { visiblePhotoCount: 1 }, history)).toMatchObject({
      kind: 'send',
      templateId: 'free-public-profile',
    });
  });
  it('uses the current progress, including pending request variation', () => {
    expect(resolve(1, { visiblePhotoCount: 1 })).toMatchObject({
      templateId: 'free-public-profile',
    });
    expect(
      resolve(1, {
        visiblePhotoCount: 1,
        visiblePinnedCount: 1,
        pendingPairCount: 1,
      })
    ).toMatchObject({ templateId: 'free-first-client', pendingRequest: true });
    expect(resolve(1, { acceptedPairCount: 1 })).toEqual({
      kind: 'finish',
      reason: 'completed',
    });
  });
  it.each([
    [{ active: false }, 'inactive'],
    [{ tipsEnabled: false }, 'unsubscribed'],
    [{ effectiveFree: false }, 'access_changed'],
    [{ hasTrialHistory: true }, 'access_changed'],
    [{ hasPaidHistory: true }, 'access_changed'],
    [{ deliveryBlocked: true }, 'delivery_blocked'],
    [{ excluded: true }, 'excluded'],
  ] satisfies Array<[Partial<FreeEmailState>, string]>)(
    'closes permanently for %j',
    (patch, reason) => {
      expect(resolve(1, patch)).toEqual({ kind: 'finish', reason });
    }
  );
  it('temporarily holds active checkout and the 48 hour spacing', () => {
    expect(resolve(1, { checkoutActive: true })).toMatchObject({
      kind: 'skip',
      reason: 'checkout_active',
    });
    expect(
      resolve(4, { visiblePhotoCount: 1 }, [
        { templateId: 'free-first-photo', opportunityId: 'd1', at: at(2.5) },
      ])
    ).toMatchObject({ kind: 'skip', reason: 'minimum_gap' });
    expect(
      resolve(4, { visiblePhotoCount: 1 }, [
        { templateId: 'free-first-photo', opportunityId: 'd1', at: at(2) },
      ])
    ).toMatchObject({ kind: 'send' });
  });
  it('consumes one opportunity even if progress changes during its window', () => {
    expect(
      resolve(1.5, { visiblePhotoCount: 1 }, [
        { templateId: 'free-first-photo', opportunityId: 'd1', at: at(1) },
      ])
    ).toMatchObject({ kind: 'skip' });
  });
  it('assigns a stable existing cohort day and sends at most once', () => {
    const existing = { ...enrollment, cohort: 'existing' };
    const offset = freeExistingOffsetDays(existing.accountId);
    expect(offset).toBeGreaterThanOrEqual(0);
    expect(offset).toBeLessThan(7);
    expect(freeExistingOffsetDays(existing.accountId)).toBe(offset);
    expect(resolveFreeEmail(existing, state, [], at(offset))).toMatchObject({
      kind: 'send',
      opportunityId: 'existing',
    });
    expect(
      resolveFreeEmail(
        existing,
        state,
        [
          {
            templateId: 'free-first-photo',
            opportunityId: 'existing',
            at: at(offset),
          },
        ],
        at(10)
      )
    ).toEqual({ kind: 'finish', reason: 'sent' });
    expect(resolveFreeEmail(existing, state, [], at(14))).toEqual({
      kind: 'finish',
      reason: 'expired',
    });
  });
});
