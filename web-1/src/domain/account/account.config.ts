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

// DECISION (nie usuwaj tego komentarza):
// SSOT for the public-visibility invariant of a stylist: a stylist surfaces on any
// public/cross-tenant read ONLY when BOTH columns hold — account_status === ACTIVE
// (admin disable/ban/expiry flips this) AND created_by_user.is_active === true
// (self soft-delete / admin-disable flips this; DOMAIN_SSOT §13.1 keeps the row
// forever). The cascade across the two columns is NOT atomic in every path, so
// either predicate alone leaks a removed stylist's PII (display_name, business_name,
// address_city, coords, avatar) or its existence (enumeration oracle).
//
// This fragment was hand-replicated across ~7 public/cross-tenant readers, each
// guarded only by a prose comment — a future reader could silently drop one
// predicate with no compile-time signal. It now lives here as ONE typed symbol.
// `satisfies` (not `:`) keeps the literal shape so it is both spreadable into a
// query-root `where` and assignable directly into a relation-filter slot
// (created_by_account / stylist). It is a READ-ONLY filter — never mutated by
// Prisma — so sharing the reference is safe; spread it (`{ ...STYLIST_PUBLICLY_VISIBLE }`)
// only at sites that add further predicates (city/search) to avoid touching the const.
//
// Cannot consume this object (kept inline, intentionally): the JS-side isStylistVisible
// boolean check in gallery-record-visibility.ts (owner-bypass branch needs the values, not a
// where) and the two raw-SQL JOINs in favorite-grouping / sitemap-profiles. Those mirror
// the SAME pair manually with their own DECISION comment. Account-profile getPublicStylistProfile_IO
// splits the pair across a findFirst (is_active) + a JS account_status check (findUnique
// cannot combine a unique id with a non-unique status), so it stays as-is. (increment-view now
// consumes this const via findFirst — see its DECISION.)
export const STYLIST_PUBLICLY_VISIBLE = {
  account_status: AccountStatusValue.ACTIVE,
  created_by_user: { is_active: true },
} satisfies Prisma.StylistAccountWhereInput;

// DECISION (nie usuwaj tego komentarza):
// SINGLE-state activeness predicate (account_status === ACTIVE, strictly). This is the
// JS-side companion to STYLIST_PUBLICLY_VISIBLE's `account_status` clause: the public
// surface (gallery-record-visibility owner-bypass, account-profile getPublicStylistProfile) is
// intentionally ACTIVE-ONLY — EXPIRING/EXPIRED/NOT_ACTIVE 404 by design (anti-oracle
// parity). It is deliberately DISTINCT from the MULTI-state notion in the kernel
// (USER_POLICY.utils.IS_ACCOUNT_STATUS_ACTIVE = status ∈ [ACTIVE, EXPIRING]), which
// gates operational access for the owner (an EXPIRING stylist still works in-app but is
// NOT publicly listed). Do NOT replace one with the other — the EXPIRING divergence is
// the whole point. Single SoT for the inline `=== ACTIVE` public-visibility check that
// was hand-replicated across the two JS mirror sites + the demo/test self-heal repairs.
export const isAccountActive = (status: AccountStatus): boolean =>
  status === AccountStatusValue.ACTIVE;
