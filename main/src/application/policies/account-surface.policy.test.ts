import { describe, expect, it } from 'vitest';
import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import { resolveAccountSurface } from './account-surface.policy';

const STYLIST = AccountTypeValue.STYLIST;
const CLIENT = AccountTypeValue.CLIENT;

describe('resolveAccountSurface', () => {
  it('pokazuje sekcje stylistki tylko w trybie stylistki', () => {
    expect(
      resolveAccountSurface({
        activeRole: STYLIST,
        hasStylistAccount: true,
        hasClientAccount: false,
      })
    ).toEqual({
      showStylistSections: true,
      showBilling: true,
      showFavoriteStylists: false,
      offerMissingRole: CLIENT,
      offerRoleSwitchTo: null,
    });
  });

  it('chowa wizytówkę i plan, gdy dwurolowy user jest w trybie klientki', () => {
    expect(
      resolveAccountSurface({
        activeRole: CLIENT,
        hasStylistAccount: true,
        hasClientAccount: true,
      })
    ).toEqual({
      showStylistSections: false,
      showBilling: false,
      showFavoriteStylists: true,
      offerMissingRole: null,
      offerRoleSwitchTo: STYLIST,
    });
  });

  it('czystej klientce proponuje konto stylistki, nie przełączenie roli', () => {
    expect(
      resolveAccountSurface({
        activeRole: CLIENT,
        hasStylistAccount: false,
        hasClientAccount: true,
      })
    ).toEqual({
      showStylistSections: false,
      showBilling: false,
      showFavoriteStylists: true,
      offerMissingRole: STYLIST,
      offerRoleSwitchTo: null,
    });
  });

  it('tryb stylistki bez konta stylistki nie odsłania sekcji stylistki', () => {
    // Role-switch race: the session already says STYLIST but the account is not yet in the
    // snapshot; sections reading stylist_account would run on empty data.
    expect(
      resolveAccountSurface({
        activeRole: STYLIST,
        hasStylistAccount: false,
        hasClientAccount: true,
      }).showStylistSections
    ).toBe(false);
  });

  it('nierozstrzygnięta sesja nie pokazuje niczego rolowego', () => {
    expect(
      resolveAccountSurface({
        activeRole: null,
        hasStylistAccount: true,
        hasClientAccount: true,
      })
    ).toEqual({
      showStylistSections: false,
      showBilling: false,
      showFavoriteStylists: true,
      offerMissingRole: null,
      offerRoleSwitchTo: null,
    });
  });
});
