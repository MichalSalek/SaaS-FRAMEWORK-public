import { afterEach, describe, expect, it } from 'vitest';
import {
  armPurchaseResumeOutcome,
  clearPurchaseResumeOutcome,
  takePurchaseResumeOutcome,
} from './purchase-resume-outcome';

afterEach(clearPurchaseResumeOutcome);
describe('resumed action outcomes', () => {
  it('counts upload completion only after publication, once', () => {
    armPurchaseResumeOutcome('upload');
    expect(takePurchaseResumeOutcome('upload', 'photo_selected')).toBeNull();
    expect(takePurchaseResumeOutcome('upload', 'failed')).toBeNull();
    expect(takePurchaseResumeOutcome('upload', 'published')).toBe('upload');
    expect(takePurchaseResumeOutcome('upload', 'published')).toBeNull();
  });
  it('does not complete an unrelated task and clears identity-bound pending state', () => {
    armPurchaseResumeOutcome('client');
    expect(takePurchaseResumeOutcome('profile', 'saved')).toBeNull();
    clearPurchaseResumeOutcome();
    expect(takePurchaseResumeOutcome('client_card', 'note_saved')).toBeNull();
  });
});
