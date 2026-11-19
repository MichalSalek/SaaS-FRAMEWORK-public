import { describe, expect, it } from 'vitest';
import { isFirstPhotoOutcomeEligible } from './useUploadAssetState.rules';

describe('first publication outcome eligibility', () => {
  it('requires a known empty server gallery and an identified account', () => {
    expect(isFirstPhotoOutcomeEligible(undefined, 'account', false)).toBe(
      false
    );
    expect(isFirstPhotoOutcomeEligible(0, null, false)).toBe(false);
    expect(isFirstPhotoOutcomeEligible(0, 'account', false)).toBe(true);
    expect(isFirstPhotoOutcomeEligible(12, 'account', false)).toBe(false);
  });
  it('never repeats the first outcome after all photos were removed', () => {
    expect(isFirstPhotoOutcomeEligible(0, 'account', true)).toBe(false);
  });
});
