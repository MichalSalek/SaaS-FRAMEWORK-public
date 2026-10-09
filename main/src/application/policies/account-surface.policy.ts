/**
 * Account Surface Policy (DDD) — co pokazuje ekran „Twoje konto".
 *
 * WHY THIS EXISTS (zgłoszenie ownera 2026-09-09):
 *   Konto bramkowało sekcje POSIADANIEM konta stylistki (`stylist_account !=
 *   null`), a nie AKTYWNĄ ROLĄ sesji. Użytkownik z dwoma kontami, który
 *   przełączył się w tryb klientki, widział mimo to wizytówkę publiczną, plan
 *   i preferencje e-mail stylistki: „na koncie klientki widzę identyczne
 *   ustawienia jak na koncie stylistki". Strona `/app/user/account/pay`
 *   bramkowała się już wtedy rolą (`useIsClient`), więc produkt mówił dwoma
 *   głosami.
 *
 * Reguła: WIDOK IDZIE ZA TRYBEM. Rola aktywna = `account_type` z sesji („w
 * czym teraz jestem"), posiadanie kont = `stylist_account` / `client_account`
 * („co mam"). Tryb decyduje, CO widać; posiadanie decyduje, CO zaproponować
 * (drugie konto albo przełączenie roli).
 *
 * Pure module — NO React, NO window. Testowany jednostkowo.
 */

import { AccountTypeValue } from '@kernel/models/db_models.generated.dto';
import type { AccountType } from '@kernel/models/db_models.generated.dto';

export interface AccountSurfaceInputs {
  /**
   * Aktywna rola sesji. `null` = sesja jeszcze nie rozstrzygnięta ALBO konto
   * bez roli — obie sytuacje traktujemy zachowawczo (bez sekcji stylistki),
   * bo pokazanie cudzych ustawień jest gorsze niż chwila ich braku.
   */
  activeRole: AccountType | null;
  hasStylistAccount: boolean;
  hasClientAccount: boolean;
}

export interface AccountSurface {
  /** Wizytówka publiczna, plan, preferencje e-mail, statystyki portfolio. */
  showStylistSections: boolean;
  /** Rozliczenia: sekcja planu w koncie + pozycja „Płatności" w railu desktopu. */
  showBilling: boolean;
  /**
   * Kafelek „Polubione stylistki" liczy zakładki klientki. Stylistka bez konta
   * klientki dostawała tu trwałe zero obok etykiety, której nie ma jak użyć.
   */
  showFavoriteStylists: boolean;
  /** Rola, której użytkownik NIE ma — zachęta do założenia drugiego konta. */
  offerMissingRole: AccountType | null;
  /**
   * Rola, którą użytkownik MA, ale jest teraz w drugiej — i przez to nie widzi
   * jej ustawień. Wypełnione tylko dla trybu klientki z kontem stylistki:
   * w drugą stronę nic się nie chowa (konto klientki nie ma własnych sekcji),
   * więc karta „przełącz" byłaby szumem.
   */
  offerRoleSwitchTo: AccountType | null;
}

export function resolveAccountSurface({
  activeRole,
  hasStylistAccount,
  hasClientAccount,
}: AccountSurfaceInputs): AccountSurface {
  const inStylistMode =
    activeRole === AccountTypeValue.STYLIST && hasStylistAccount;
  const inClientMode = activeRole === AccountTypeValue.CLIENT;

  let offerMissingRole: AccountType | null = null;
  if (inStylistMode && !hasClientAccount) {
    offerMissingRole = AccountTypeValue.CLIENT;
  } else if (inClientMode && !hasStylistAccount) {
    offerMissingRole = AccountTypeValue.STYLIST;
  }

  return {
    showStylistSections: inStylistMode,
    showBilling: inStylistMode,
    showFavoriteStylists: hasClientAccount,
    offerMissingRole,
    offerRoleSwitchTo:
      inClientMode && hasStylistAccount ? AccountTypeValue.STYLIST : null,
  };
}
