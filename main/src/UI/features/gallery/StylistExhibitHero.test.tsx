import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { AppHeroVisibilityContext } from '../../components/AppHero/appHeroVisibility';
import { AppBarTitleMolecule } from '../../layouts/AppLayout.appBarTitle.molecule';
import { StylistExhibitHeroOrganism } from './StylistExhibitHero.organism';

vi.mock('next-intl', () => ({
  useTranslations: () => (key: string) => key,
}));

const hero = (
  <StylistExhibitHeroOrganism
    displayName='Magda Nowak'
    businessName='Salon Magdy'
    city='Kraków'
    isPaired
    totalCount={1}
    uniqueColors={0}
    uniqueStyles={0}
  />
);

describe('stylist gallery heading', () => {
  it('keeps the app bar as the only h1 and preserves the stylist card', () => {
    render(
      <AppHeroVisibilityContext.Provider
        value={{ reportVisible: vi.fn(), reportPresent: vi.fn() }}>
        <AppBarTitleMolecule
          avatar={null}
          title='Galeria: Magda Nowak'
          asHeading
        />
        {hero}
      </AppHeroVisibilityContext.Provider>
    );

    expect(screen.getAllByRole('heading', { level: 1 })).toHaveLength(1);
    expect(
      screen.getByRole('heading', { level: 1, name: 'Galeria: Magda Nowak' })
    ).toBeVisible();
    expect(
      screen.getByRole('heading', { level: 2, name: 'Magda Nowak' })
    ).toBeVisible();
    expect(screen.getByText('Salon Magdy')).toBeVisible();
    expect(screen.getByText('Kraków')).toBeVisible();
    expect(screen.getByText('stylistExhibitPairedBadge')).toBeVisible();
  });

  it('uses an h1 without an app bar, including the null desktop context', () => {
    render(
      <AppHeroVisibilityContext.Provider value={null}>
        {hero}
      </AppHeroVisibilityContext.Provider>
    );
    expect(
      screen.getByRole('heading', { level: 1, name: 'Magda Nowak' })
    ).toBeVisible();
  });
});
