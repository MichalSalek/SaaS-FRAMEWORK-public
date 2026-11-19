// Render-sanity: the shared row's link kinds and its second control.
//
// DECISION: a deliberate EXCEPTION to the convention "frontend Vitest = hooks/logic, not UI
// components". Three things about this primitive are invisible to tsc, the audits and a
// screenshot, and each cost something once: (1) a `tel:` passed through the pages link gets a
// trailing slash and the number stops dialing; (2) an external link with `target='_blank'` loses
// the session in the native shell; (3) the row's second control nested INSIDE the link is an
// interactive element in an interactive one (a click on the menu also opens the row).
import { describe, expect, it, vi } from 'vitest';
import { fireEvent, screen } from '@testing-library/react';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { NavRowListMolecule, NavRowMolecule } from './NavRow.molecule';

describe('NavRowMolecule link kinds', () => {
  it('keeps a tel: href as written and hands the event to onClick', () => {
    const onClick = vi.fn((event: { preventDefault: () => void }) =>
      event.preventDefault()
    );
    renderWithProviders(
      <NavRowMolecule
        href='tel:+48600100200'
        label='Zadzwoń'
        onClick={onClick}
      />
    );
    const row = screen.getByRole('link', { name: 'Zadzwoń' });
    expect(row.getAttribute('href')).toBe('tel:+48600100200');
    fireEvent.click(row);
    expect(onClick).toHaveBeenCalledTimes(1);
    expect(onClick.mock.calls[0]?.[0]).toHaveProperty('preventDefault');
  });

  it('never opens an external row in a new tab', () => {
    renderWithProviders(
      <NavRowMolecule href='https://example.com' external label='Strona' />
    );
    const row = screen.getByRole('link', { name: 'Strona' });
    expect(row.getAttribute('target')).toBeNull();
    expect(row.getAttribute('rel')).toContain('noopener');
  });
});

describe('NavRowMolecule end control', () => {
  it('renders the second control beside the row, not inside it', () => {
    renderWithProviders(
      <NavRowListMolecule ariaLabel='Klientki'>
        <NavRowMolecule
          href='/app/clients/1'
          label='Julia Nowak'
          end={<button type='button'>Więcej</button>}
        />
      </NavRowListMolecule>
    );
    const row = screen.getByRole('link', { name: 'Julia Nowak' });
    const menu = screen.getByRole('button', { name: 'Więcej' });
    expect(row.contains(menu)).toBe(false);
    expect(row.closest('li')).toBe(menu.closest('li'));
  });

  it('gives a static row a cell for its control outside a list', () => {
    renderWithProviders(
      <NavRowMolecule
        label='Konto nieaktywne'
        note='Zwolnij miejsce, żeby połączyć kolejną klientkę.'
        end={<button type='button'>Zwolnij</button>}
      />
    );
    const menu = screen.getByRole('button', { name: 'Zwolnij' });
    expect(screen.getByText('Konto nieaktywne').closest('a')).toBeNull();
    expect(menu.parentElement?.parentElement?.textContent).toContain(
      'Zwolnij miejsce'
    );
  });
});

describe('NavRowListSkeletonMolecule', () => {
  it('draws the loading list from the row structure, hidden from readers', async () => {
    const { NavRowListSkeletonMolecule } = await import('./NavRow.molecule');
    const { container } = renderWithProviders(
      <NavRowListSkeletonMolecule rows={4} leading lines={3} />
    );
    expect(container.querySelectorAll('li')).toHaveLength(4);
    expect(container.firstElementChild?.getAttribute('aria-hidden')).toBe(
      'true'
    );
    expect(container.querySelectorAll('a, button')).toHaveLength(0);
  });
});
