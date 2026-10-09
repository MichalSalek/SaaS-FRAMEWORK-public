import { describe, it, expect } from 'vitest';
import { createTapSequence } from './tapSequence';

describe('createTapSequence', () => {
  it('only the newest tap on a record is latest', () => {
    const seq = createTapSequence();
    const first = seq.begin('a');
    const second = seq.begin('a');
    expect(seq.isLatest('a', first)).toBe(false);
    expect(seq.isLatest('a', second)).toBe(true);
  });

  it('taps on other records do not supersede each other', () => {
    const seq = createTapSequence();
    const a = seq.begin('a');
    const b = seq.begin('b');
    expect(seq.isLatest('a', a)).toBe(true);
    expect(seq.isLatest('b', b)).toBe(true);
  });

  it('an unknown record has no latest tap', () => {
    const seq = createTapSequence();
    expect(seq.isLatest('a', 1)).toBe(false);
  });
});
