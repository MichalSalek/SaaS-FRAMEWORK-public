import {
  QUERY_FIELD,
  type QueryField,
} from '../../application/contracts/query-fields';
import { LOG_APPLICATIONS, LOG_ENVIRONMENTS } from './log-triage.config';
import { SEND_LOG_TYPES } from './send-log.config';
import { PricingPlanValue } from '../pricing/pricing.config';
import {
  AccountStatusValue,
  AccountTypeValue,
  PaymentStatusValue,
} from '../../models/db_models.generated.dto';

export const ADMIN = {
  group: 'ADMIN' as const,
  access: 'ADMIN' as const,
  authCheck: true as const,
  limiterTier: 'default' as const,
};

export const ACCOUNT_TYPES = [
  AccountTypeValue.STYLIST,
  AccountTypeValue.CLIENT,
] as const;
export const ACCOUNT_STATUSES = [
  AccountStatusValue.ACTIVE,
  AccountStatusValue.NOT_ACTIVE,
  AccountStatusValue.EXPIRING,
  AccountStatusValue.EXPIRED,
] as const;
export const PAYMENT_STATUSES = [
  PaymentStatusValue.UNPAID,
  PaymentStatusValue.PAID,
  PaymentStatusValue.IN_PROGRESS,
  PaymentStatusValue.REJECTED,
] as const;
export const PRICING_PLANS = [
  PricingPlanValue.FREE,
  PricingPlanValue.PRO,
  PricingPlanValue.PRO_PLUS,
  PricingPlanValue.STUDIO,
  PricingPlanValue.SCALE,
] as const;
export const SORT_ORDERS = ['asc', 'desc'] as const;

export const requiredInt = (
  fallback: number
): QueryField<number, number> & { readonly required: true } => ({
  required: true,
  decode: QUERY_FIELD.int(fallback).decode,
});

export const requiredOneOf = <T extends string>(
  values: readonly T[]
): QueryField<T, T | undefined> & { readonly required: true } => ({
  required: true,
  decode: QUERY_FIELD.oneOf(values).decode,
});

export const logsFilterQuery = {
  environment: QUERY_FIELD.oneOf(LOG_ENVIRONMENTS),
  application: QUERY_FIELD.oneOf(LOG_APPLICATIONS),
  type: QUERY_FIELD.oneOf(SEND_LOG_TYPES),
};
