/**
 * SSOT dla formatowania cen po stronie UI — ceny przychodzą ze Stripe w
 * GROSZACH (minor units); ta warstwa sprowadza je do złotych (major units) w
 * jednym, nazwanym miejscu. Powielony inline `Math.round(price / 100)` żył
 * wcześniej w /pricing (tierSection), karcie account/pay i obu mini-cennikach
 * LP (for-stylists / for-studios) — 5 kopii tej samej semantyki, którą jeden
 * bug (brak /100) zamieniał w „6000 PLN/mies." (S39). Nazwana funkcja =
 * czytelność + jeden punkt, w którym konwersja jest poprawna.
 *
 * DECISION (nie usuwaj tego komentarza):
 * `PriceSlot.atom` (components/) trzyma WŁASNY `formatMinorUnits` mimo tej samej
 * arytmetyki — warstwa `components/` NIE może zależeć od `features/` (kierunek
 * importu), więc dublet jest tam celowy i architektonicznie wymuszony, nie
 * przeoczony. Ten helper obsługuje wyłącznie call-site'y warstwy features.
 */

/** Grosze (minor units) → całe złote (major units), zaokrąglone. */
export const groszToPln = (minorUnits: number): number =>
  Math.round(minorUnits / 100);
