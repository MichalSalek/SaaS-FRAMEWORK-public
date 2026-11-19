import type { PricingPlan } from '../pricing/pricing.config';

export type SalonStaffNotFoundError = {
  type: 'SALON_STAFF_NOT_FOUND';
  staffId: string;
};

export type SalonStaffAlreadyExistsError = {
  type: 'SALON_STAFF_ALREADY_EXISTS';
  email: string;
  salonAccountId: string;
};

export type SalonStaffLimitReachedError = {
  type: 'SALON_STAFF_LIMIT_REACHED';
  currentCount: number;
  limit: number;
  planType: PricingPlan;
};

export type SalonStaffSelfInviteError = {
  type: 'SALON_STAFF_SELF_INVITE';
  accountId: string;
};

export type SalonStaffError =
  | SalonStaffNotFoundError
  | SalonStaffAlreadyExistsError
  | SalonStaffLimitReachedError
  | SalonStaffSelfInviteError;
