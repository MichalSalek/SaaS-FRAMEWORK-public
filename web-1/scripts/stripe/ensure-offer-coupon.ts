/**
 * Idempotent retrieve-or-create for the Nailfolio first-month coupon.
 *
 * Do not run this from a worker session. The orchestrator runs it once
 * against the LIVE Stripe account.
 *
 * Usage, from web-1, with the production env already loaded (the same way
 * `npm run dev` loads it). The script never prints the secret key:
 *   npx tsx scripts/stripe/ensure-offer-coupon.ts
 */

import {
  EMAIL_OFFERS,
  PLAN_ID_MAP,
  isScopedToNailfolio,
} from '@kernel/domain/stripe/stripe.config';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';

const OFFER_PLAN_IDS = new Set<string>([
  PLAN_ID_MAP.PRO,
  PLAN_ID_MAP.PRO_PLUS,
  PLAN_ID_MAP.STUDIO,
]);

const isMissingCoupon = (error: unknown): boolean => {
  if (error == null || typeof error !== 'object') {
    return false;
  }
  const code = (error as { code?: unknown }).code;
  return code === 'resource_missing';
};

const main = async (): Promise<void> => {
  const stripe = getStripe();
  const productIds: string[] = [];
  for await (const product of stripe.products.list({
    active: true,
    limit: 100,
  })) {
    const planId = product.metadata['planId'];
    const projectId = product.metadata['projectId'];
    if (projectId && projectId !== STRIPE_PROJECT_ID) {
      continue;
    }
    if (!isScopedToNailfolio(planId) || !OFFER_PLAN_IDS.has(planId)) {
      continue;
    }
    productIds.push(product.id);
  }

  if (productIds.length !== OFFER_PLAN_IDS.size) {
    throw new Error(
      `Expected ${OFFER_PLAN_IDS.size} Nailfolio products (app-price-1/2/3), found ${productIds.length}`
    );
  }

  const couponId = EMAIL_OFFERS.FIRST_MONTH.couponId;
  let existing: Awaited<ReturnType<typeof stripe.coupons.retrieve>> | null =
    null;
  try {
    existing = await stripe.coupons.retrieve(couponId);
  } catch (error: unknown) {
    if (!isMissingCoupon(error)) {
      throw error;
    }
  }
  if (existing) {
    if (
      existing.percent_off !== EMAIL_OFFERS.FIRST_MONTH.percentOff ||
      existing.duration !== 'once'
    ) {
      throw new Error(
        `Coupon ${couponId} already exists with different terms. Refusing to overwrite.`
      );
    }
    console.log(`Coupon ${couponId} already exists. Nothing to create.`);
    return;
  }

  await stripe.coupons.create({
    id: couponId,
    // Visible on the customer's invoice line.
    name: `Pierwszy miesiąc ${EMAIL_OFFERS.FIRST_MONTH.percentOff}% taniej`,
    percent_off: EMAIL_OFFERS.FIRST_MONTH.percentOff,
    duration: 'once',
    applies_to: { products: productIds },
    metadata: { projectId: STRIPE_PROJECT_ID },
  });
  console.log(`Created coupon ${couponId} on ${productIds.length} products.`);
};

main().catch((error: unknown) => {
  const message =
    error instanceof Error ? error.message : 'ensure-offer-coupon failed';
  console.error(message);
  process.exitCode = 1;
});
