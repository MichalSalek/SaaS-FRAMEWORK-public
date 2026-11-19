import { describe, expect, it } from 'vitest';
import { qInt, qNum } from './query-params.utils';

describe('qInt — pagination params are integers (testy-api s34)', () => {
  it('floors a fractional value that Prisma take/skip would reject', () => {
    expect(qInt({ take: '1.5' }, 'take')).toBe(1);
    expect(qInt({ take: '20' }, 'take')).toBe(20);
  });

  it('keeps the qNum null contract for missing and non-finite input', () => {
    expect(qInt({}, 'take')).toBeNull();
    expect(qInt({ take: 'abc' }, 'take')).toBeNull();
    expect(qInt({ take: 'Infinity' }, 'take')).toBeNull();
    expect(qNum({ lat: '52.2297' }, 'lat')).toBe(52.2297);
  });
});
