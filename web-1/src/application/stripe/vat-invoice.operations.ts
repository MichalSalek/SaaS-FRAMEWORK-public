import type Stripe from 'stripe';
import { VALIDATION_MESSAGES } from '@kernel/domain/i18n/validation.i18n';
import type { CountryCode } from '@kernel/domain/localization/country.config';
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
  ValidationError,
} from '@kernel/application/common-errors.types';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { reportIssueBackend } from '@app/debugger/error-handler';
import { normalizeNip } from '@kernel/policies/validation/validation.utils';
import { getStripe } from './adapters/stripe.adapter';
import { retryStripeOperation } from './stripe-retry.utils';

/**
 * Save company details on the Stripe Customer before confirm(). The „Faktura na firmę"
 * subform posts here first. The invoice is generated at confirm, so name, address and
 * tax id must already be on the Customer. userId comes from the session.
 * DECISION: read tax ids first and update name and address last. Stripe has no rollback;
 * the other order can leave a new name with the old NIP.
 * Test: web-1/src/application/stripe/vat-invoice.operations.test.ts (call order on
 * mocked Stripe; not a partial failure on live Stripe).
 */
export const saveVatInvoiceDetails_IO = async ({
  userId,
  companyName,
  nip,
  taxId,
  country = 'PL',
  addressState,
  addressLine1,
  addressLine2,
  addressCity,
  addressPostalCode,
}: {
  userId: string;
  companyName: string;
  nip?: string | undefined;
  taxId?: { type: string; value: string } | null | undefined;
  country?: CountryCode | undefined;
  addressState?: string | undefined;
  addressLine1: string;
  addressLine2?: string;
  addressCity: string;
  addressPostalCode: string;
}): Promise<
  OperationResult<
    { ok: true },
    | AccountNotFoundError
    | AccountStripeError
    | CheckoutCustomerNotReadyError
    | ValidationError
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
    // DECISION: a missing customer is a BROKEN invariant, but a predictable one (subform sent
    // before the panel minted the checkout session, the mint failed on a Stripe error, a
    // pre-SPE account). Returning ACCOUNT_STRIPE_ERROR made error-mapper produce an opaque 500
    // with no telemetry while the front blocked `checkout.confirm()`: a stylist hard-blocked on
    // payment with no trace. So: (a) a dedicated domain error mapped to 409 (transient state, the
    // client knows to retry after the panel refresh and can tell it from a Stripe outage), (b) a
    // `mode:'warn'` report BEFORE returning so the operator sees the broken invariant.
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

  // Create the replacement first: invalid IDs must not remove a valid existing ID.
  const rawTaxId = nip ? { type: 'eu_vat', value: nip } : taxId;
  const requestedTaxId =
    rawTaxId &&
    country === 'PL' &&
    rawTaxId.type === 'eu_vat' &&
    (/^PL/i.test(rawTaxId.value.trim()) || /^[\d\s-]+$/.test(rawTaxId.value))
      ? { ...rawTaxId, value: `PL${normalizeNip(rawTaxId.value)}` }
      : rawTaxId;
  if (requestedTaxId) {
    const existing: Stripe.TaxId[] = [];
    let cursor: string | undefined;
    for (;;) {
      const result = await retryStripeOperation({
        fn: () =>
          stripe.customers.listTaxIds(stripeCustomerId, {
            limit: 100,
            ...(cursor && { starting_after: cursor }),
          }),
        namespace: 'STRIPE_VAT_TAX_ID_LIST',
        payload: { accountId: account.account_id },
        redactErrorMessage: true,
      });
      if (!result.ok) {
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'saveVatInvoiceDetails',
          stripeError: 'Stripe customers.listTaxIds failed',
        });
      }
      existing.push(...result.value.data);
      if (!result.value.has_more) {
        break;
      }
      const next = result.value.data.at(-1)?.id;
      if (!next || next === cursor) {
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'saveVatInvoiceDetails',
          stripeError: 'Invalid tax ID pagination',
        });
      }
      cursor = next;
    }
    const sameType = existing.filter(
      entry => entry.type === requestedTaxId.type
    );
    if (!sameType.some(entry => entry.value === requestedTaxId.value)) {
      const created = await retryStripeOperation({
        fn: () =>
          stripe.customers.createTaxId(stripeCustomerId, {
            type: requestedTaxId.type as Stripe.TaxIdCreateParams.Type,
            value: requestedTaxId.value,
          }),
        namespace: 'STRIPE_VAT_TAX_ID_CREATE',
        payload: { accountId: account.account_id },
        redactErrorMessage: true,
      });
      if (!created.ok) {
        if (created.attempts.at(-1)?.errorStatus === 400) {
          return failure({
            type: 'VALIDATION_ERROR',
            field: nip ? 'nip' : 'taxId',
            message: VALIDATION_MESSAGES.vatInvoice.taxIdInvalid,
          });
        }
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'saveVatInvoiceDetails',
          stripeError: 'Stripe customers.createTaxId failed',
        });
      }
    }
    for (const stale of sameType.filter(
      entry => entry.value !== requestedTaxId.value
    )) {
      const removed = await retryStripeOperation({
        fn: () => stripe.customers.deleteTaxId(stripeCustomerId, stale.id),
        namespace: 'STRIPE_VAT_TAX_ID_DELETE',
        payload: { accountId: account.account_id },
        redactErrorMessage: true,
      });
      if (!removed.ok) {
        return failure({
          type: 'ACCOUNT_STRIPE_ERROR',
          operation: 'saveVatInvoiceDetails',
          stripeError: 'Stripe customers.deleteTaxId failed',
        });
      }
    }
  }

  // 3. Customer name and buyer address are updated last.
  //    Last on purpose; rationale in the ORDER OF STRIPE CALLS DECISION at the top of the file.
  const updateResult = await retryStripeOperation({
    fn: () =>
      stripe.customers.update(stripeCustomerId, {
        name: companyName,
        metadata: { nailfolio_company_details: 'true' },
        address: {
          line1: addressLine1,
          ...(addressLine2 !== undefined && { line2: addressLine2 }),
          city: addressCity,
          postal_code: addressPostalCode,
          country,
          ...(addressState !== undefined && { state: addressState }),
        },
      }),
    namespace: 'STRIPE_VAT_CUSTOMER_UPDATE',
    payload: { accountId: account.account_id },
    redactErrorMessage: true,
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
