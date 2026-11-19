import { describe, it, expect } from 'vitest';
import { firstBeyondPublicLimit } from './pinnedOrder.helpers';

describe('firstBeyondPublicLimit', () => {
  it('marks the row right after the plan limit when there are more pins than the profile shows', () => {
    // After a downgrade to Free: 6 pins kept, the profile shows 3.
    expect(firstBeyondPublicLimit(6, 3)).toBe(3);
  });

  it('marks nothing when every pin fits the limit', () => {
    expect(firstBeyondPublicLimit(3, 3)).toBeNull();
    expect(firstBeyondPublicLimit(2, 10)).toBeNull();
  });

  it('marks nothing while the limit is unknown or unlimited', () => {
    expect(firstBeyondPublicLimit(12, null)).toBeNull();
  });
});
