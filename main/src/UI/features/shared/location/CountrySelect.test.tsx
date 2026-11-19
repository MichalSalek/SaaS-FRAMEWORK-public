import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { CountrySelectMolecule } from './CountrySelect.molecule';

const names = vi.hoisted(() => ({ client: false }));
vi.mock('next-intl', () => ({ useLocale: () => 'pl' }));
vi.mock('@kernel/domain/localization/country.config', () => ({
  COUNTRY_CODES: ['FK'],
  countryDisplayName: () =>
    names.client ? 'Falklandy (Malwiny)' : 'Falklandy',
}));

afterEach(() => {
  names.client = false;
  vi.restoreAllMocks();
});

describe('country selector hydration', () => {
  it('does not mix server and browser CLDR names during hydration', async () => {
    const element = (
      <CountrySelectMolecule label='Kraj' placeholder='Wybierz kraj' value='' />
    );
    const html = renderToString(element);
    expect(html).not.toContain('Falklandy');
    const container = document.createElement('div');
    document.body.append(container);
    container.innerHTML = html;
    names.client = true;
    const errors = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(container, element);
    });
    expect(container.querySelector('option[value="FK"]')?.textContent).toBe(
      'Falklandy (Malwiny)'
    );
    expect(errors.mock.calls.flat().join(' ')).not.toContain('Hydration');
    await act(async () => root?.unmount());
    container.remove();
  });
});
