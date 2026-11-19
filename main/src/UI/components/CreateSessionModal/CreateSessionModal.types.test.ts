import { describe, expect, it } from 'vitest';
import { resolveStylistsStatus } from './CreateSessionModal.types';

const ONE_PAIR = [{}];

describe('resolveStylistsStatus', () => {
  it('is loading while the first fetch is in flight', () => {
    expect(
      resolveStylistsStatus({
        isLoading: true,
        isError: false,
        hasData: false,
        pairs: [],
      })
    ).toBe('loading');
  });

  it('is error when the fetch failed with nothing cached', () => {
    // Regression: an empty `pairs` from a failed fetch rendered „no paired
    // stylists, pair with one" — the list was unknown, not empty.
    expect(
      resolveStylistsStatus({
        isLoading: false,
        isError: true,
        hasData: false,
        pairs: [],
      })
    ).toBe('error');
  });

  it('is error when a refetch failed over an EMPTY cached list', () => {
    // TQ v5 keeps the empty list on a failed refetch; its emptiness is not
    // confirmed, so the modal must offer retry, not „pair with a stylist".
    expect(
      resolveStylistsStatus({
        isLoading: false,
        isError: true,
        hasData: true,
        pairs: [],
      })
    ).toBe('error');
  });

  it('stays ready when a refetch failed but a non-empty list is cached', () => {
    expect(
      resolveStylistsStatus({
        isLoading: false,
        isError: true,
        hasData: true,
        pairs: ONE_PAIR,
      })
    ).toBe('ready');
  });

  it('is ready after a successful fetch, empty or not', () => {
    expect(
      resolveStylistsStatus({
        isLoading: false,
        isError: false,
        hasData: true,
        pairs: [],
      })
    ).toBe('ready');
    expect(
      resolveStylistsStatus({
        isLoading: false,
        isError: false,
        hasData: true,
        pairs: ONE_PAIR,
      })
    ).toBe('ready');
  });
});
