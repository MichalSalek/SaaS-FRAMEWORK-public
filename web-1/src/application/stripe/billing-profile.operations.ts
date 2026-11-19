import type Stripe from 'stripe';
import type { BillingProfile } from '@kernel/domain/account/billing-profile.contract-schemas';
import type { OperationResult } from '@kernel/application/result.types';
import { failure, success } from '@kernel/application/result.types';
import type {
  AccountNotFoundError,
  DatabaseError,
} from '@kernel/application/common-errors.types';
import type { AccountStripeError } from '@kernel/domain/user-and-account/account-errors.types';
import { normalizeCountryCode } from '@kernel/domain/localization/country.config';
import { DB_CLIENT } from '@app/db/db.client';
import { databaseFailure } from '@app/errors/error-result.helpers';
import { getStripe } from './adapters/stripe.adapter';

/** Read only: never create a Stripe customer while loading account settings. */
export const getBillingProfile_IO = async (
  userId: string
): Promise<
  OperationResult<
    BillingProfile,
    AccountNotFoundError | DatabaseError | AccountStripeError
  >
> => {
  let account;
  try {
    account = await DB_CLIENT.use.stylistAccount.findUnique({
      where: { created_by_user_id: userId },
      select: { stripe_customer_id: true },
    });
  } catch (error) {
    return databaseFailure('getBillingProfile:fetchAccount', error);
  }
  if (!account) {
    return failure({ type: 'ACCOUNT_NOT_FOUND', accountId: userId });
  }
  const id = account.stripe_customer_id;
  if (!id) {
    return success({
      has_customer: false,
      company_name: null,
      country: null,
      address_line1: null,
      address_city: null,
      address_postal_code: null,
      address_state: null,
      tax_ids: [],
      has_company_details: false,
    });
  }
  try {
    const stripe = getStripe();
    const customer = await stripe.customers.retrieve(id);
    if (customer.deleted) {
      throw new Error('Stripe customer deleted');
    }
    const taxIds: BillingProfile['tax_ids'] = [];
    let cursor: string | undefined;
    for (;;) {
      const page: Stripe.ApiList<Stripe.TaxId> =
        await stripe.customers.listTaxIds(id, {
          limit: 100,
          ...(cursor && { starting_after: cursor }),
        });
      taxIds.push(
        ...page.data.map(tax => ({
          type: tax.type,
          value: tax.value,
          verification_status: tax.verification?.status ?? null,
        }))
      );
      if (!page.has_more) {
        break;
      }
      const next = page.data.at(-1)?.id;
      if (!next || next === cursor) {
        throw new Error('Invalid tax ID pagination');
      }
      cursor = next;
    }
    return success({
      has_customer: true,
      company_name: customer.name ?? null,
      country: normalizeCountryCode(customer.address?.country),
      address_line1: customer.address?.line1 ?? null,
      address_line2: customer.address?.line2 ?? null,
      address_city: customer.address?.city ?? null,
      address_postal_code: customer.address?.postal_code ?? null,
      address_state: customer.address?.state ?? null,
      tax_ids: taxIds,
      has_company_details: Boolean(
        (customer.metadata?.nailfolio_company_details === 'true' ||
          taxIds.length > 0) &&
        customer.name &&
        normalizeCountryCode(customer.address?.country) &&
        customer.address?.line1 &&
        (normalizeCountryCode(customer.address.country) !== 'PL' ||
          (customer.address.city && customer.address.postal_code))
      ),
    });
  } catch {
    // Stripe errors can echo private address/tax data; keep them out of logs and responses.
    return failure({
      type: 'ACCOUNT_STRIPE_ERROR',
      operation: 'getBillingProfile',
      stripeError: 'Stripe customer read failed',
    });
  }
};
