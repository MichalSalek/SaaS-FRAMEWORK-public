// Render-sanity: the shared row's link kinds and its second control.
//
// DECISION (nie usuwaj tego komentarza): swiadomy WYJATEK od konwencji
// "frontend Vitest = hooki/logika, NIE komponenty UI". Trzy rzeczy tego
// prymitywu sa niewidoczne dla tsc, audytow i zrzutu ekranu, a kazda juz raz
// kosztowala: (1) `tel:` puszczony przez link stron dostaje ukosnik na koncu
// i numer przestaje dzwonic; (2) link zewnetrzny z `target='_blank'` gubi
// sesje w skorupie natywnej; (3) druga kontrolka wiersza zagniezdzona W linku
// to interaktywny element w interaktywnym (klik w menu otwiera tez wiersz).
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
