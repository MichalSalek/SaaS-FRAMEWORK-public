import { describe, expect, it } from 'vitest';
import { messagingMarkReadSchema } from '@kernel/domain/messaging/messaging.contract-schemas';

describe('message read cursor date boundary', () => {
  it.each([
    '-271821-04-20T00:00:00.000Z',
    '0000-12-31T23:59:59Z',
    '2026-02-31T12:00:00Z',
  ])('rejects %s before it reaches PostgreSQL', readThrough => {
    expect(
      messagingMarkReadSchema.safeParse({
        pair_id: 'own-pair',
        read_through: readThrough,
      }).success
    ).toBe(false);
  });

  it.each([undefined, '2026-03-01T00:30:00+02:00', '2028-02-29T12:00:00Z'])(
    'accepts the omitted cursor and real calendar instants: %s',
    readThrough => {
      expect(
        messagingMarkReadSchema.safeParse({
          pair_id: 'own-pair',
          ...(readThrough !== undefined ? { read_through: readThrough } : {}),
        }).success
      ).toBe(true);
    }
  );
});
