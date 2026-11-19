import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useProfileCountry } from './useProfileCountry';

const detected = vi.hoisted(() => ({
  country: undefined as string | undefined,
}));
vi.mock('./useDetectedCountry', () => ({
  useDetectedCountry: () => ({
    data: detected.country ? { country_code: detected.country } : undefined,
  }),
}));

beforeEach(() => {
  detected.country = undefined;
});
describe('profile country selection', () => {
  it('prefers a saved legacy country over detection and does not change it on travel', () => {
    detected.country = 'DE';
    const view = renderHook(({ saved }) => useProfileCountry(saved, 'a'), {
      initialProps: { saved: 'Polska' as string | null },
    });
    expect(view.result.current.country).toBe('PL');
    detected.country = 'US';
    view.rerender({ saved: 'Polska' });
    expect(view.result.current.country).toBe('PL');
  });
  it('offers detection only until manual selection and replaces a suggestion when saved data arrives', () => {
    detected.country = 'DE';
    const view = renderHook(({ saved }) => useProfileCountry(saved, 'a'), {
      initialProps: { saved: null as string | null },
    });
    expect(view.result.current.country).toBe('DE');
    view.rerender({ saved: 'PL' });
    expect(view.result.current.country).toBe('PL');
    act(() => view.result.current.chooseCountry('US'));
    detected.country = 'FR';
    view.rerender({ saved: 'DE' });
    expect(view.result.current.country).toBe('US');
  });
  it('starts empty without detection and resets across identities', () => {
    const view = renderHook(({ id }) => useProfileCountry(null, id), {
      initialProps: { id: 'a' },
    });
    expect(view.result.current.country).toBe('');
    act(() => view.result.current.chooseCountry('DE'));
    view.rerender({ id: 'b' });
    expect(view.result.current.country).toBe('');
  });
});
