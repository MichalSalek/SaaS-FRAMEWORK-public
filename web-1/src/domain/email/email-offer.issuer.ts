/**
 * Per-recipient promotion code on the Nailfolio first-month coupon.
 *
 * Created at send time, outside any database transaction. A Stripe failure
 * returns null and the caller sends the mail without the offer. The code id
 * and string are written on the email EventLog so a later sweep reuses them
 * instead of minting a second code.
 */

import { randomInt } from 'node:crypto';
import type Stripe from 'stripe';
import { EMAIL_OFFERS } from '@kernel/domain/stripe/stripe.config';
import { TIME } from '@kernel/application/constants.config';
import { EventLogTypeValue } from '@kernel/models/db_models.generated.dto';
import { DB_CLIENT } from '@app/db/db.client';
import { getStripe } from '@app/stripe/adapters/stripe.adapter';
import { STRIPE_PROJECT_ID } from '@app/stripe/stripe.types';
import { reportIssueBackend } from '@app/debugger/error-handler';

export type IssuedEmailOffer = {
  code: string;
  promotionCodeId: string;
  expiresAt: Date;
  applied: boolean;
};

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export const promotionCodeFromName = (displayName: string): string => {
  const first = displayName.trim().split(/\s+/)[0] ?? '';
  // Ł, ł and ß have no NFD decomposition, so they would simply vanish
  // ("Łucja" → "UCJA"); spell them out before stripping diacritics.
  const ascii = first
    .replace(/Ł/g, 'L')
    .replace(/ł/g, 'l')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z]/g, '')
    .toUpperCase()
    .slice(0, 12);
  const stem = ascii.length >= 2 ? ascii : 'NF';
  let suffix = '';
  for (let i = 0; i < 4; i += 1) {
    suffix += CODE_ALPHABET[randomInt(CODE_ALPHABET.length)] ?? 'X';
  }
  return `${stem}-${suffix}`;
};

const couponIdOf = (promo: Stripe.PromotionCode): string | null => {
  const coupon = promo.promotion?.coupon;
  if (typeof coupon === 'string') {
    return coupon;
  }
  if (coupon && typeof coupon === 'object' && 'id' in coupon) {
    return coupon.id;
  }
  return null;
};

type StoredOffer = {
  promotionCodeId: string;
  promotionCode: string;
  offerExpiresAt: string;
  offerApplied?: boolean;
};

const readStoredOffer = (payload: unknown): StoredOffer | null => {
  if (payload == null || typeof payload !== 'object') {
    return null;
  }
  const body = (payload as { responseBody?: unknown }).responseBody;
  if (body == null || typeof body !== 'object') {
    return null;
  }
  const record = body as Record<string, unknown>;
  if (
    typeof record['promotionCodeId'] !== 'string' ||
    typeof record['promotionCode'] !== 'string' ||
    typeof record['offerExpiresAt'] !== 'string'
  ) {
    return null;
  }
  return {
    promotionCodeId: record['promotionCodeId'],
    promotionCode: record['promotionCode'],
    offerExpiresAt: record['offerExpiresAt'],
    offerApplied: record['offerApplied'] === true,
  };
};

const reuseStoredOffer = async (args: {
  userId: string;
  infoEvent: string;
}): Promise<IssuedEmailOffer | null> => {
  const lookback = new Date(
    Date.now() - (EMAIL_OFFERS.FIRST_MONTH.validHours + 24) * TIME.MS_PER_HOUR
  );
  const prior = await DB_CLIENT.use.eventLog.findFirst({
    where: {
      created_by_user_id: args.userId,
      event: args.infoEvent,
      event_type: EventLogTypeValue.EMAIL,
      created_at: { gte: lookback },
    },
    orderBy: { created_at: 'desc' },
    select: { event_payload: true },
  });
  const stored = readStoredOffer(prior?.event_payload);
  if (!stored) {
    return null;
  }
  const expiresAt = new Date(stored.offerExpiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    return null;
  }
  return {
    code: stored.promotionCode,
    promotionCodeId: stored.promotionCodeId,
    expiresAt,
    applied: stored.offerApplied === true,
  };
};

// DECISION (nie usuwaj tego komentarza, 2026-09-23):
// The offer is "the first MONTH 20% cheaper" and the coupon is `duration:
// once`, which Stripe applies to the next invoice whatever its length. A trial
// can run on a yearly price (canStartTrial ignores the interval), so applying
// the code there took 20% off a whole year. Checkout honours codes on monthly
// billing only (resolveCheckoutDiscounts_IO); D29 follows the same rule and
// its mail goes out without an offer for a yearly subscription.
export const isMonthlyOnly = (
  items: ReadonlyArray<{ price: { recurring: { interval: string } | null } }>
): boolean =>
  items.length > 0 &&
  items.every(item => item.price.recurring?.interval === 'month');

const applyToSubscription = async (
  subscriptionId: string,
  promotionCodeId: string
): Promise<boolean> => {
  try {
    await getStripe().subscriptions.update(subscriptionId, {
      discounts: [{ promotion_code: promotionCodeId }],
    });
    return true;
  } catch (error: unknown) {
    reportIssueBackend({
      namespace: 'EMAIL_OFFER_APPLY_FAILED',
      message:
        'First-month discount was not applied to the subscription. The mail goes out without offerApplied.',
      payload: {
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
    return false;
  }
};

/**
 * Mint or reuse a one-redemption code. `applyToSubscriptionId` is set only
 * for a trialing subscription that is not cancel_at_period_end (D29).
 */
export const issueFirstMonthOffer_IO = async (args: {
  userId: string;
  templateId: string;
  infoEvent: string;
  displayName: string;
  stripeCustomerId: string | null;
  applyToSubscriptionId: string | null;
}): Promise<IssuedEmailOffer | null> => {
  try {
    if (args.applyToSubscriptionId) {
      const subscription = await getStripe().subscriptions.retrieve(
        args.applyToSubscriptionId
      );
      if (!isMonthlyOnly(subscription.items.data)) {
        return null;
      }
    }

    const existing = await reuseStoredOffer({
      userId: args.userId,
      infoEvent: args.infoEvent,
    });
    if (existing) {
      if (args.applyToSubscriptionId && !existing.applied) {
        const applied = await applyToSubscription(
          args.applyToSubscriptionId,
          existing.promotionCodeId
        );
        return { ...existing, applied };
      }
      return existing;
    }

    const expiresAt = new Date(
      Date.now() + EMAIL_OFFERS.FIRST_MONTH.validHours * TIME.MS_PER_HOUR
    );
    const created = await getStripe().promotionCodes.create({
      promotion: {
        type: 'coupon',
        coupon: EMAIL_OFFERS.FIRST_MONTH.couponId,
      },
      code: promotionCodeFromName(args.displayName),
      max_redemptions: 1,
      expires_at: Math.floor(expiresAt.getTime() / 1000),
      ...(args.stripeCustomerId ? { customer: args.stripeCustomerId } : {}),
      metadata: {
        projectId: STRIPE_PROJECT_ID,
        userId: args.userId,
        templateId: args.templateId,
      },
    });

    const couponId = couponIdOf(created);
    if (couponId !== EMAIL_OFFERS.FIRST_MONTH.couponId) {
      reportIssueBackend({
        namespace: 'EMAIL_OFFER_COUPON_MISMATCH',
        message:
          'Minted promotion code is not on the Nailfolio first-month coupon',
        payload: { couponId },
        mode: 'error',
      });
      return null;
    }

    const applied = args.applyToSubscriptionId
      ? await applyToSubscription(args.applyToSubscriptionId, created.id)
      : false;

    return {
      code: created.code,
      promotionCodeId: created.id,
      expiresAt,
      applied,
    };
  } catch (error: unknown) {
    reportIssueBackend({
      namespace: 'EMAIL_OFFER_ISSUE_FAILED',
      message:
        'Stripe promotion code was not created. The mail goes out without the offer.',
      payload: {
        templateId: args.templateId,
        error: error instanceof Error ? error.message : String(error),
      },
      mode: 'error',
    });
    return null;
  }
};
