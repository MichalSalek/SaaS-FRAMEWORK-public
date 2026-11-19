import type Stripe from 'stripe';
import { getStripe } from './adapters/stripe.adapter';
import { isScopedToNailfolio } from './stripe.config';

export const listActiveRecurringPrices = async (): Promise<Stripe.Price[]> => {
  const prices: Stripe.Price[] = [];
  let startingAfter: string | undefined;
  for (;;) {
    const page: Stripe.ApiList<Stripe.Price> = await getStripe().prices.list({
      active: true,
      type: 'recurring',
      expand: ['data.product'],
      limit: 100,
      ...(startingAfter !== undefined && { starting_after: startingAfter }),
    });
    prices.push(
      ...page.data.filter(price => {
        const product = price.product;
        return (
          typeof product !== 'string' &&
          !product.deleted &&
          isScopedToNailfolio(product.metadata.planId ?? '')
        );
      })
    );
    if (!page.has_more) {
      break;
    }
    const next = page.data.at(-1)?.id;
    if (!next || next === startingAfter) {
      throw new Error('Invalid Stripe price pagination');
    }
    startingAfter = next;
  }
  return prices;
};
