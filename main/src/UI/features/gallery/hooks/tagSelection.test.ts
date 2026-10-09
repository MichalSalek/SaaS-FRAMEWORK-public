import { describe, expect, it } from 'vitest';
import {
  isSelectionFull,
  toggleCappedSelection,
  toggleSelection,
} from './tagSelection';

describe('toggleCappedSelection', () => {
  it('adds an id below the cap', () => {
    expect(toggleCappedSelection(['a'], 'b', 3)).toEqual(['a', 'b']);
  });

  it('returns the SAME array when adding past the cap (no re-render churn)', () => {
    const prev = ['a', 'b', 'c'];
    expect(toggleCappedSelection(prev, 'd', 3)).toBe(prev);
  });

  it('keeps a selected id removable at the cap', () => {
    expect(toggleCappedSelection(['a', 'b', 'c'], 'b', 3)).toEqual(['a', 'c']);
  });
});

describe('toggleSelection', () => {
  it('toggles without a cap', () => {
    expect(toggleSelection(['a'], 'b')).toEqual(['a', 'b']);
    expect(toggleSelection(['a', 'b'], 'a')).toEqual(['b']);
  });
});

describe('isSelectionFull', () => {
  it('is true exactly at the cap', () => {
    expect(isSelectionFull(['a', 'b'], 3)).toBe(false);
    expect(isSelectionFull(['a', 'b', 'c'], 3)).toBe(true);
  });
});
