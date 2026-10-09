import { DB_CLIENT } from '@app/db/db.client';
import type { OperationResult } from '@kernel/application/result.types';
import { success, failure } from '@kernel/application/result.types';
import type {
  AccountStripeError,
  CheckoutCustomerNotReadyError,
} from '@kernel/domain/user-and-account/account-errors.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { normalizeNip } from '@kernel/policies/validation/validation.utils';
import { getStripe } from './adapters/stripe.adapter';
import { retryStripeOperation } from './stripe-retry.utils';

/**
 * Faktura VAT — zapis danych firmowych kupującego na Stripe Customer PRZED confirm().
 *
 * DECISION (nie usuwaj tego komentarza):
 * save-przed-confirm: subform „Faktura na firmę" POSTuje tu ZANIM front wywoła
 * `checkout.confirm()`. Faktura VAT jest generowana przez Stripe dopiero przy confirm,
 * więc name/adres/tax_id MUSZĄ być już na Customerze w tym momencie — inaczej pierwsza
 * faktura wyjdzie bez NIP/adresu. Customer POWINIEN istnieć: embedded checkout mint
 * (createEmbeddedCheckoutSession_IO → getOrCreateStripeCustomer) tworzy go przy
 * montażu panelu — ale „powinien" to nie „na pewno" (patrz DECISION przy
 * CHECKOUT_CUSTOMER_NOT_READY niżej). userId ZAWSZE z sesji (handler przekazuje
 * session.userId), NIGDY z body.
 *
 * DECISION (nie usuwaj tego komentarza) — KOLEJNOŚĆ WYWOŁAŃ STRIPE:
 * czytamy tax_idy NAJPIERW, a `customers.update` (nazwa + adres) leci NA KOŃCU.
 * Operacja nie jest transakcyjna — Stripe nie ma rollbacku — więc jedyną dźwignią
 * jest ustawienie kroków tak, by awaria w locie zostawiła Customera możliwie
 * nietkniętego. Odwrotna kolejność (update jako krok 2) zapisywała NOWĄ nazwę firmy
 * i NOWY adres, a potem mogła wywalić się na tax_id — Customer zostawał z danymi
 * z bieżącego formularza i STARYM (albo żadnym) NIP-em, czyli dokładnie w stanie,
 * na którym faktura wychodzi z niepasującym numerem i kupujący nie odliczy VAT.
 * Przy obecnej kolejności awaria przed ostatnim krokiem zostawia poprzednią, spójną
 * tożsamość, a użytkownik ponawia zapis (operacja jest idempotentna po wartości).
 */
export const saveVatInvoiceDetails_IO = async ({
  userId,
  companyName,
  nip,
  addressLine1,
  addressCity,
  addressPostalCode,
}: {
  userId: string;
  companyName: string;
  nip: string;
  addressLine1: string;
  addressCity: string;
  addressPostalCode: string;
}): Promise<
  OperationResult<
    { ok: true },
    | AccountNotFoundError
    | AccountStripeError
    | CheckoutCustomerNotReadyError
    | DatabaseError
  >
> => {
  // 1. Resolve stylist account + stripe_customer_id po userId (z sesji).
  let account;
  try {
    account = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { created_by_user_id: userId },
      select: { account_id: true, stripe_customer_id: true },
    });
  } catch (error) {
    return databaseFailure('saveVatInvoiceDetails:fetchAccount', error);
  }

  if (!account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }

  const stripeCustomerId = account.stripe_customer_id;
  if (stripeCustomerId === null) {
    // DECISION (nie usuwaj tego komentarza):
    // Brak customera = ZŁAMANY INVARIANT, ale przewidywalny (subform wysłany zanim
    // panel zamintował sesję checkout, mint przepadł na błędzie Stripe, konto
    // sprzed SPE). Poprzednia wersja zwracała ACCOUNT_STRIPE_ERROR, który error-mapper
    // składa do opaque 500 BEZ jakiejkolwiek telemetrii: ani wpisu w error-store, ani
    // alertu — a front łapał 500 i blokował `checkout.confirm()`. Efekt: stylistka
    // twardo zablokowana na płatności i NIGDZIE nie było śladu dlaczego.
    // Dlatego: (a) osobny błąd domenowy → 409 (stan przejściowy, klient wie, że ma
    // ponowić po odświeżeniu panelu, i odróżnia to od awarii Stripe), (b) report
    // `mode:'warn'` PRZED zwrotem, żeby operator widział złamany invariant.
    reportIssueBackend({
      namespace: 'VAT_INVOICE_CUSTOMER_NOT_READY',
      message:
        'Zapis danych do faktury VAT bez Stripe Customera — sesja checkout nie została zamintowana (złamany invariant save-przed-confirm)',
      payload: { userId, accountId: account.account_id },
      mode: 'warn',
    });
    return failure({
      type: 'CHECKOUT_CUSTOMER_NOT_READY',
      accountId: account.account_id,
    });
  }

  const stripe = getStripe();

  // 2. Tax ID (eu_vat) idempotentnie PO WARTOŚCI: zgodny PL<nip> zostaje nietknięty,
  //    rozjechany jest kasowany i zakładany od nowa (patrz DECISION niżej).
  const listTaxIdsResult = await retryStripeOperation({
    fn: () => stripe.customers.listTaxIds(stripeCustomerId, { limit: 100 }),
    namespace: 'STRIPE_VAT_TAX_ID_LIST',
    payload: { accountId: account.account_id },
  });

  if (!listTaxIdsResult.ok) {
    const lastAttempt =
      listTaxIdsResult.attempts[listTaxIdsResult.attempts.length - 1];
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'saveVatInvoiceDetails',
      stripeError:
        lastAttempt?.errorMessage ?? 'Stripe customers.listTaxIds failed',
    });
  }

  // DECISION (nie usuwaj tego komentarza):
  // Idempotencja po WARTOŚCI, nie po samej obecności wpisu. Wersja „istnieje
  // jakikolwiek eu_vat → pomiń" wyglądała na idempotentną, ale znaczyła „NIP-u nie
  // da się już poprawić": zapis nazwy i adresu leci bezwarunkowo, więc po korekcie
  // literówki Customer dostawał NOWĄ nazwę firmy ze STARYM NIP-em, a endpoint i tak
  // odpowiadał 200 — cicha porażka na polu, które w PL decyduje o możliwości
  // odliczenia VAT przez kupującego. Podglądu danych nie ma (endpoint jest tylko
  // zapisem), więc stylistka nie miała jak tego zauważyć, a subform wraca przy każdej
  // zmianie planu — scenariusz korekty jest zwyczajną ścieżką.
  // tax_id w Stripe jest NIEMUTOWALNY, ale usuwalny, więc korekta = delete + create.
  // Kasujemy tylko wpisy `eu_vat` (inne typy nie są nasze i zostają nietknięte).
  const vatValue = `PL${normalizeNip(nip)}`;
  const euVatTaxIds = listTaxIdsResult.value.data.filter(
    taxId => taxId.type === 'eu_vat'
  );
  const staleEuVatTaxIds = euVatTaxIds.filter(
    taxId => taxId.value !== vatValue
  );
  const hasEuVat = euVatTaxIds.length > staleEuVatTaxIds.length;

  for (const staleTaxId of staleEuVatTaxIds) {
    const deleteTaxIdResult = await retryStripeOperation({
      fn: () => stripe.customers.deleteTaxId(stripeCustomerId, staleTaxId.id),
      namespace: 'STRIPE_VAT_TAX_ID_DELETE',
      payload: { accountId: account.account_id },
    });

    if (!deleteTaxIdResult.ok) {
      const lastAttempt =
        deleteTaxIdResult.attempts[deleteTaxIdResult.attempts.length - 1];
      return failure({
        type: 'ACCOUNT_STRIPE_ERROR',
        operation: 'saveVatInvoiceDetails',
        stripeError:
          lastAttempt?.errorMessage ?? 'Stripe customers.deleteTaxId failed',
      });
    }
  }

  if (!hasEuVat) {
    const createTaxIdResult = await retryStripeOperation({
      fn: () =>
        stripe.customers.createTaxId(stripeCustomerId, {
          type: 'eu_vat',
          value: vatValue,
        }),
      namespace: 'STRIPE_VAT_TAX_ID_CREATE',
      payload: { accountId: account.account_id },
    });

    if (!createTaxIdResult.ok) {
      const lastAttempt =
        createTaxIdResult.attempts[createTaxIdResult.attempts.length - 1];
      return failure({
        type: 'ACCOUNT_STRIPE_ERROR',
        operation: 'saveVatInvoiceDetails',
        stripeError:
          lastAttempt?.errorMessage ?? 'Stripe customers.createTaxId failed',
      });
    }
  }

  // 3. Na końcu Customer.name + adres (country zawsze PL — sprzedawca to polski
  //    podatnik VAT, adres firmowy krajowy; patrz DECISION w account-checkout.types).
  //    Ostatni krok z rozmysłem — uzasadnienie w DECISION „KOLEJNOŚĆ WYWOŁAŃ STRIPE".
  const updateResult = await retryStripeOperation({
    fn: () =>
      stripe.customers.update(stripeCustomerId, {
        name: companyName,
        address: {
          line1: addressLine1,
          city: addressCity,
          postal_code: addressPostalCode,
          country: 'PL',
        },
      }),
    namespace: 'STRIPE_VAT_CUSTOMER_UPDATE',
    payload: { accountId: account.account_id },
  });

  if (!updateResult.ok) {
    const lastAttempt = updateResult.attempts[updateResult.attempts.length - 1];
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'saveVatInvoiceDetails',
      stripeError:
        lastAttempt?.errorMessage ?? 'Stripe customers.update failed',
    });
  }

  return success({ ok: true });
};
