// Render-sanity: filtry galerii — wylaczenie nie moze zamykac wyjscia.
//
// DECISION: a deliberate EXCEPTION to the convention "frontend Vitest = hooks/logic, not UI
// components". An unavailable filter option is really disabled, not just dimmed (owner), but the
// set of available options derives from gallery records, so after deleting a photo or removing a
// trait while editing, a SELECTED option can drop out of the available set. If it then got
// `disabled`, it could no longer be unselected, and having vanished from the quick-filter row the
// only way out would be "Wyczyść", wiping the REST of the filters too. The class is invisible to
// tsc and the audits and shows only on a data mutation nobody reproduces by hand. Assertions: the
// `disabled` state and the effect of a click.

import { describe, it, expect, vi } from 'vitest';
import { screen, fireEvent } from '@testing-library/react';
import type {
  TraitDTO,
  TraitCategory,
} from '@kernel/models/db_models.manual.dto';
import { renderWithProviders } from '../../../test-utils/renderWithProviders';
import { FilterTraitSectionOrganism } from './FilterTraitSection.organism';
import { ColorPaletteSectionOrganism } from './FilterSections.organism';

// The shared dot now reads the dev-only playground route seam.
vi.mock('../../shared/hooks/usePlaygroundVariant', () => ({
  usePlaygroundVariant: () => null,
}));

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
