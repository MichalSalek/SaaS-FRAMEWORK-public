// Render-sanity: filtry galerii — wylaczenie nie moze zamykac wyjscia.
//
// DECISION (nie usuwaj tego komentarza): swiadomy WYJATEK od konwencji
// "frontend Vitest = hooki/logika, NIE komponenty UI". Owner zdecydowal
// (S98), ze niedostepna opcja filtra ma byc REALNIE wylaczona, a nie tylko
// wygaszona. To poprawne, ale ma jeden ostry brzeg: zbior dostepnych opcji
// derywuje z rekordow galerii, wiec po usunieciu zdjecia albo zdjeciu cechy
// przy edycji WYBRANA opcja potrafi wypasc z dostepnych. Gdyby wtedy dostala
// `disabled`, przestalaby sie dac odznaczyc, a z rzedu szybkich filtrow juz
// znikla — jedynym wyjsciem zostaloby "Wyczysc", kasujace RESZTE filtrow
// razem z nia. Klasa jest niewidoczna dla tsc i audytow (typy sie zgadzaja,
// zaden regex tego nie zlapie) i wychodzi tylko przy mutacji danych, ktorej
// nikt nie odtworzy recznie. Asercje: stan `disabled` i skutek klikniecia.

import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type {
  TraitDTO,
  TraitCategory,
} from '@kernel/models/db_models.manual.dto';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { FilterTraitSectionOrganism } from './FilterTraitSection.organism';
import { ColorPaletteSectionOrganism } from './FilterSections.organism';

const trait = (id: string, name: string): TraitDTO =>
  ({ id, name, category: 'technique' as TraitCategory }) as TraitDTO;

const OMBRE = trait('t-ombre', 'Ombre');
const BABY_BOOMER = trait('t-baby', 'Baby boomer');

const traitsByCategory = new Map<TraitCategory, TraitDTO[]>([
  ['technique', [OMBRE, BABY_BOOMER]],
]);

const renderTraits = (selected: string[], available: TraitDTO[]) => {
  const onToggleTrait = vi.fn();
  renderWithProviders(
    <FilterTraitSectionOrganism
      traitsByCategory={traitsByCategory}
      selectedTraits={selected}
      availableTraits={available}
      isSearching={false}
      searchQuery=''
      filteredTraitsCount={2}
      onToggleTrait={onToggleTrait}
    />
  );
  return { onToggleTrait };
};

describe('FilterTraitSection — wylaczanie niedostepnych cech', () => {
  it('wylacza cechę niedostępną i niewybraną', () => {
    renderTraits([], [OMBRE]);
    expect(screen.getByRole('button', { name: /baby boomer/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /ombre/i })).toBeEnabled();
  });

  it('NIE wylacza cechy WYBRANEJ, ktora wypadla z dostepnych — musi dac sie odznaczyc', () => {
    const { onToggleTrait } = renderTraits(['t-baby'], [OMBRE]);
    const orphan = screen.getByRole('button', { name: /baby boomer/i });
    expect(orphan).toBeEnabled();
    fireEvent.click(orphan);
    expect(onToggleTrait).toHaveBeenCalledWith('t-baby');
  });

  // Wygaszenie MUSI isc tym samym warunkiem co wylaczenie. Kontrolka wlaczona
  // i wygaszona naraz to tekst ~2,6:1 BEZ zwolnienia WCAG 1.4.3 (zwolnienie
  // dotyczy kontrolek nieaktywnych) plus wygaszony pierscien fokusu.
  // Stan wybrania musi byc PROGRAMOWY: checkbox jest tu tylko rysowany, wiec bez
  // `aria-pressed` czytnik oglasza filtr wlaczony i wylaczony identycznie.
  it('wystawia stan wybrania czytnikowi ekranu', () => {
    renderTraits(['t-baby'], [OMBRE, BABY_BOOMER]);
    expect(
      screen.getByRole('button', { name: /baby boomer/i })
    ).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /ombre/i })).toHaveAttribute(
      'aria-pressed',
      'false'
    );
  });

  it('nie wygasza cechy, ktora zostala klikalna', () => {
    renderTraits(['t-baby'], [OMBRE]);
    expect(
      screen.getByRole('button', { name: /baby boomer/i }).className
    ).not.toContain('traitDimmed');
    renderTraits([], [OMBRE]);
    expect(
      screen.getAllByRole('button', { name: /baby boomer/i })[1]?.className
    ).toContain('traitDimmed');
  });
});

const RED = { id: 'c-red', name: 'Czerwony', hex_code: '#c0392b' };
const NUDE = { id: 'c-nude', name: 'Nude', hex_code: '#d8b9a0' };

const renderColors = (selected: string[], available: (typeof RED)[]) => {
  const onToggleColor = vi.fn();
  renderWithProviders(
    <ColorPaletteSectionOrganism
      filteredColors={[RED, NUDE] as never}
      availableColors={available as never}
      selectedColors={selected}
      isSearching={false}
      searchQuery=''
      onToggleColor={onToggleColor}
    />
  );
  return { onToggleColor };
};

describe('ColorPaletteSection — wylaczanie niedostepnych kolorow', () => {
  it('wylacza kolor niedostępny i niewybrany', () => {
    renderColors([], [RED]);
    expect(screen.getByRole('button', { name: /nude/i })).toBeDisabled();
    expect(screen.getByRole('button', { name: /czerwony/i })).toBeEnabled();
  });

  it('NIE wylacza koloru WYBRANEGO, ktory wypadl z dostepnych', () => {
    const { onToggleColor } = renderColors(['c-nude'], [RED]);
    const orphan = screen.getByRole('button', { name: /nude/i });
    expect(orphan).toBeEnabled();
    fireEvent.click(orphan);
    expect(onToggleColor).toHaveBeenCalledWith('c-nude');
  });

  it('nie wygasza koloru, ktory zostal klikalny', () => {
    renderColors(['c-nude'], [RED]);
    const wrapper = screen
      .getByRole('button', { name: /nude/i })
      .closest('div');
    expect(wrapper?.className ?? '').not.toContain('traitDimmed');
  });
});
