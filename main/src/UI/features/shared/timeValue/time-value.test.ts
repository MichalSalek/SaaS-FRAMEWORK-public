import { describe, expect, it } from 'vitest';
import { calculateTimeValue } from './time-value';

describe('calculateTimeValue', () => {
  it('converts the example day into minutes and hours', () => {
    expect(calculateTimeValue('15', '10')).toEqual({
      totalMinutes: 150,
      hours: 2,
      remainingMinutes: 30,
    });
  });

  it('accepts zero and whole hours', () => {
    expect(calculateTimeValue('0', '10')).toEqual({
      totalMinutes: 0,
      hours: 0,
      remainingMinutes: 0,
    });
    expect(calculateTimeValue('30', '2')).toEqual({
      totalMinutes: 60,
      hours: 1,
      remainingMinutes: 0,
    });
  });

  it.each([
    ['', '10'],
    ['15', ''],
    ['-1', '10'],
    ['1.5', '10'],
    ['NaN', '10'],
    ['Infinity', '10'],
    ['9007199254740992', '1'],
    ['9007199254740991', '2'],
  ])('rejects invalid or unsafe input %s and %s', (minutes, clients) => {
    expect(calculateTimeValue(minutes, clients)).toBeNull();
  });
});
