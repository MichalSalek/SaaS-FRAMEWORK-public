// useGalleryFilterOptions.test.ts
// The filter sheet must learn that its taxonomy failed to load (those reads
// raise no global toast), and a retry must clear the failure. MSW at the HTTP
// level, so the test holds across data-layer rewrites.

import { describe, it, expect, vi } from 'vitest';

const localeState = vi.hoisted(() => ({ locale: 'pl' }));
vi.mock('next-intl', () => ({ useLocale: () => localeState.locale }));
import { renderHook, waitFor, act } from '@testing-library/react';
import { http, HttpResponse } from 'msw';
import {
  makeTestQueryClient,
  createQueryWrapper,
} from '../../../../../test-utils/renderWithProviders';
import { mswServer } from '../../../../../test-utils/msw/server';
import { useGalleryFilterOptions } from './useGalleryFilterOptions';
import { useGalleryFiltersState } from './useGalleryFiltersState';

const COLORS_URL = '*/api/v1/gallery/colors';
const TRAITS_URL = '*/api/v1/gallery/traits';

const colorsOk = () =>
  HttpResponse.json({
    event: 'APPLICATION_SUCCESS',
    data: [{ id: 'c1', name: 'Czerwony', hex_code: '#c00000' }],
  });
const traitsOk = () =>
  HttpResponse.json({
    event: 'APPLICATION_SUCCESS',
    data: [{ id: 't1', name: 'French', category: 'TECHNIQUE' }],
  });
const serverError = () =>
  HttpResponse.json({ event: 'GENERAL_ERROR', data: null }, { status: 500 });

describe('useGalleryFilterOptions', () => {
  it('reports no failure when both option lists load', async () => {
    mswServer.use(
      http.get(COLORS_URL, colorsOk),
      http.get(TRAITS_URL, traitsOk)
    );

    const { result } = renderHook(() => useGalleryFilterOptions(), {
      wrapper: createQueryWrapper(makeTestQueryClient()),
    });

    await waitFor(() => expect(result.current.colors).toHaveLength(1));
    await waitFor(() => expect(result.current.traits).toHaveLength(1));
    expect(result.current.optionsLoadFailed).toBe(false);
  });

  it('flags a failed list with nothing cached and clears it after a retry', async () => {
    mswServer.use(
      http.get(COLORS_URL, serverError),
      http.get(TRAITS_URL, traitsOk)
    );

    const { result } = renderHook(() => useGalleryFilterOptions(), {
      wrapper: createQueryWrapper(makeTestQueryClient()),
    });

    await waitFor(() => expect(result.current.optionsLoadFailed).toBe(true));
    expect(result.current.colors).toHaveLength(0);

    mswServer.use(http.get(COLORS_URL, colorsOk));
    act(() => {
      result.current.retryOptions();
    });

    await waitFor(() => expect(result.current.optionsLoadFailed).toBe(false));
    expect(result.current.colors).toHaveLength(1);
  });
});

describe('localized gallery options on cached data', () => {
  it('updates every global label when the locale changes without mutating cached API data', async () => {
    const client = makeTestQueryClient();
    mswServer.use(
      http.get(COLORS_URL, () =>
        HttpResponse.json({
          event: 'APPLICATION_SUCCESS',
          data: [{ id: 'c1', name: 'Czerwone', hex_code: '#ff0000' }],
        })
      ),
      http.get(TRAITS_URL, () =>
        HttpResponse.json({
          event: 'APPLICATION_SUCCESS',
          data: [{ id: 't1', name: 'Jednolite', category: 'technique' }],
        })
      )
    );
    localeState.locale = 'en';
    const { result, rerender } = renderHook(() => useGalleryFilterOptions(), {
      wrapper: createQueryWrapper(client),
    });
    await waitFor(() =>
      expect(result.current.traits[0]?.name).toBe('Solid color')
    );
    expect(result.current.colors[0]?.name).toBe('Red');
    localeState.locale = 'de';
    rerender();
    expect(result.current.traits[0]?.name).toBe('Einfarbig');
    expect(result.current.colors[0]?.name).toBe('Rot');
    localeState.locale = 'pl';
    rerender();
    expect(result.current.traits[0]?.name).toBe('Jednolite');
    expect(result.current.colors[0]?.name).toBe('Czerwone');
  });
});

it('localizes filters derived from gallery records while preserving selected IDs', () => {
  const records = [
    {
      colors: [{ id: 'c1', name: 'Różowe', hex_code: '#ff69b4' }],
      traits: [
        {
          id: 't1',
          name: 'Wzorki',
          category: 'technique' as const,
          icon_url: null,
          is_featured: false,
        },
      ],
      nail_length: 'SHORT',
    },
  ];
  localeState.locale = 'en';
  const { result, rerender } = renderHook(() =>
    useGalleryFiltersState(records)
  );
  expect(result.current.availableColors[0]?.name).toBe('Pink');
  expect(result.current.availableTraits[0]?.name).toBe('Patterns');
  act(() => result.current.toggleTrait('t1'));
  localeState.locale = 'de';
  rerender();
  expect(result.current.availableTraits[0]?.name).toBe('Muster');
  expect(result.current.filteredRecords).toEqual(records);
  expect(records[0]?.traits[0]?.name).toBe('Wzorki');
  localeState.locale = 'pl';
});
