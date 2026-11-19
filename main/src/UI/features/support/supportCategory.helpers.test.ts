import { describe, expect, it } from 'vitest';
import { SupportThreadCategoryValue } from '@kernel/models/support/support.dto';
import plCommon from '../../../locales/pl/common.json';
import enCommon from '../../../locales/en/common.json';
import deCommon from '../../../locales/de/common.json';
import {
  SUPPORT_CATEGORIES,
  readCategoryParam,
} from './supportCategory.helpers';

describe('readCategoryParam', () => {
  it('accepts exactly one known category', () => {
    expect(readCategoryParam('BUG')).toBe('BUG');
    expect(readCategoryParam('IDEA')).toBe('IDEA');
  });

  it('treats everything else as nothing preselected', () => {
    for (const value of [
      undefined,
      '',
      'bug',
      'NONE',
      'SPAM',
      ['BUG', 'IDEA'],
    ]) {
      expect(readCategoryParam(value)).toBe(null);
    }
  });
});

describe('support category labels', () => {
  it('the select offers every category of the contract', () => {
    expect([...SUPPORT_CATEGORIES].sort()).toEqual(
      Object.values(SupportThreadCategoryValue).sort()
    );
  });

  // A category added to the enum without copy would render a raw key in the
  // select, in the list row and in the thread header.
  for (const [locale, common] of Object.entries({
    pl: plCommon,
    en: enCommon,
    de: deCommon,
  })) {
    it(`${locale}: every category has a non-empty label`, () => {
      const labels: Record<string, string> = common.pages.support.categories;
      for (const category of SUPPORT_CATEGORIES) {
        expect((labels[category] ?? '').trim().length).toBeGreaterThan(0);
      }
    });
  }
});
