import type { Prisma } from '../../prisma/js-client';

import { PricingPlanValue } from '@kernel/domain/pricing/pricing.config';
import type { AccountStatus } from '@kernel/models/db_models.generated.dto';
import {
  AccountStatusValue,
  PaymentStatusValue,
} from '@kernel/models/db_models.generated.dto';

export const defaultNewMasterAdminSettings: Prisma.StylistAccountCreateWithoutCreated_by_userInput =
  {
    pricing_plan: PricingPlanValue.SCALE,
    account_status: AccountStatusValue.ACTIVE,
    payment_status: PaymentStatusValue.PAID,
  } as const;

export const STYLIST_PUBLICLY_VISIBLE = {
  account_status: AccountStatusValue.ACTIVE,
  created_by_user: { is_active: true },
} satisfies Prisma.StylistAccountWhereInput;

// DECISION: public visibility is ACTIVE-only (EXPIRING/EXPIRED/NOT_ACTIVE 404 by design). It is
// deliberately distinct from the kernel's IS_ACCOUNT_STATUS_ACTIVE (ACTIVE or EXPIRING), which
// gates the owner's in-app access: an EXPIRING stylist still works but is not publicly listed.
// Do not swap one for the other.
export const isAccountActive = (status: AccountStatus): boolean =>
  status === AccountStatusValue.ACTIVE;
