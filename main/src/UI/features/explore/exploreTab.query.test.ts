import { describe, it, expect } from 'vitest';
import { ROUTES_FRONT } from '@kernel/domain/routing/routing.config';
import {
  EXPLORE_TAB_QUERY_PARAM,
  buildExploreTabHref,
  parseExploreTabQuery,
} from './exploreTab.query';

describe('parseExploreTabQuery', () => {
  it('returns a known tab', () => {
    expect(parseExploreTabQuery('stylists')).toBe('stylists');
    expect(parseExploreTabQuery('styles')).toBe('styles');
  });

  it('takes the first value of a repeated param', () => {
    expect(parseExploreTabQuery(['stylists', 'styles'])).toBe('stylists');
  });

  it('returns null for an absent or unknown value', () => {
    expect(parseExploreTabQuery(undefined)).toBeNull();
    expect(parseExploreTabQuery('')).toBeNull();
    expect(parseExploreTabQuery('Stylists')).toBeNull();
    expect(parseExploreTabQuery([])).toBeNull();
  });
});

describe('buildExploreTabHref', () => {
  it('round-trips through the parser', () => {
    const href = buildExploreTabHref('stylists');
    expect(href).toBe(
      `${ROUTES_FRONT.EXPLORE}?${EXPLORE_TAB_QUERY_PARAM}=stylists`
    );
    const value = new URL(href, 'https://x.test').searchParams.get(
      EXPLORE_TAB_QUERY_PARAM
    );
    expect(parseExploreTabQuery(value ?? undefined)).toBe('stylists');
  });
});
