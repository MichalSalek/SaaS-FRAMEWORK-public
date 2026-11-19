import { describe, expect, it } from 'vitest';
import { lifecycleEmailCounts } from './free-email.pipeline';
describe('lifecycle delivery report', () => {
  it('does not treat provider acceptance or absent webhook as delivery', () => {
    expect(
      lifecycleEmailCounts([
        { status: 'accepted', deliveryStatus: null, count: 3 },
      ])
    ).toMatchObject({ accepted: 3, delivered: 0, unknown: 0 });
  });
  it('counts latest delivery state independently of send outcome', () => {
    expect(
      lifecycleEmailCounts([
        { status: 'accepted', deliveryStatus: 'delivered', count: 2 },
        { status: 'accepted', deliveryStatus: 'bounced', count: 1 },
        { status: 'unknown', deliveryStatus: null, count: 1 },
        { status: 'sending', deliveryStatus: null, count: 1 },
        { status: 'suppressed', deliveryStatus: null, count: 4 },
      ])
    ).toMatchObject({
      accepted: 3,
      delivered: 2,
      bounced: 1,
      unknown: 2,
      suppressed: 4,
    });
  });
});
