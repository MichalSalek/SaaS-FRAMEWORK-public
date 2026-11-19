import { describe, expect, it } from 'vitest';
import { crawlerFilterOptions } from './crawler-filter-options';

describe('crawlerFilterOptions', () => {
  it('includes a selected filter absent from statistics', () => {
    expect(crawlerFilterOptions([], 'GPTBot')).toEqual(['GPTBot']);
  });

  it('deduplicates and sorts existing and selected values', () => {
    expect(crawlerFilterOptions(['Zeta', 'Alpha', 'Alpha'], 'Alpha')).toEqual([
      'Alpha',
      'Zeta',
    ]);
    expect(crawlerFilterOptions(['Zeta', 'Alpha'], 'Beta')).toEqual([
      'Alpha',
      'Beta',
      'Zeta',
    ]);
  });

  it('omits an unset selection without mutating statistics values', () => {
    const values = ['Zeta', 'Alpha'];
    expect(crawlerFilterOptions(values, null)).toEqual(['Alpha', 'Zeta']);
    expect(crawlerFilterOptions(values, undefined)).toEqual(['Alpha', 'Zeta']);
    expect(crawlerFilterOptions(values, '')).toEqual(['Alpha', 'Zeta']);
    expect(values).toEqual(['Zeta', 'Alpha']);
  });
});
