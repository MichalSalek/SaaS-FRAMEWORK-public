import { describe, expect, it } from 'vitest';
import { adminSupportAwaitingReplyHref } from '@kernel/domain/admin/admin-support-url.config';
import {
  ADMIN_SUPPORT_URL_CODEC,
  DEFAULT_SUPPORT_TAB,
} from './support-filters.model';

const queryOf = (href: string) =>
  Object.fromEntries(new URL(href, 'https://example.test').searchParams);

describe('admin support URL codec', () => {
  it('an empty query is the default tab and builds a clean URL', () => {
    const state = ADMIN_SUPPORT_URL_CODEC.parse({});
    expect(state.tab).toBe(DEFAULT_SUPPORT_TAB);
    expect(ADMIN_SUPPORT_URL_CODEC.build(state)).toEqual({});
  });

  it('the badge link selects the awaiting list and round-trips', () => {
    const query = queryOf(adminSupportAwaitingReplyHref());
    const state = ADMIN_SUPPORT_URL_CODEC.parse(query);
    expect(state.tab).toBe('AWAITING');
    expect(ADMIN_SUPPORT_URL_CODEC.build(state)).toEqual(query);
  });

  it('an unknown value falls back to the default tab', () => {
    expect(ADMIN_SUPPORT_URL_CODEC.parse({ filter: 'everything' }).tab).toBe(
      DEFAULT_SUPPORT_TAB
    );
    expect(ADMIN_SUPPORT_URL_CODEC.parse({ filter: 'toString' }).tab).toBe(
      DEFAULT_SUPPORT_TAB
    );
  });
});
