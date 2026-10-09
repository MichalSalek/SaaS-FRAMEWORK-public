# Plan: Payment and Data Hygiene (PDH)

> Date: code delivered 2026-06-24
> Status: CODE DONE, waiting on owner-side verification
> Effort: none left for code; the remaining items are manual

This file has been cut down to its tail: the delivered work is summarized, and only the open items
that need the owner remain. Once they are closed the file is deleted.

## DOCUMENTATION CASCADE (after the plan is finished)

> **MANDATORY.** These updates are part of "done".

1. **`_MASTER_IMPLEMENTATION_INDEX.md`**: remove the PDH row, append the name to "Completed"
2. **Domain docs**: already updated (schema decision record for the cached likes counter, decision comments in code)
3. **Changelog**: entry written on 2026-06-24
4. **Delete** this plan file (git history keeps it)

- [ ] `_MASTER_IMPLEMENTATION_INDEX.md`, row PDH: remove after owner actions 1 and 2

---

## Goal

Three hygiene fixes shipped as one plan: (1) a paid-to-paid plan change that behaves correctly
under strong customer authentication, so an abandoned 3D Secure challenge never switches the plan;
(2) a denormalized likes counter on the stylist account instead of counting on read; (3) cleanup
of an uploaded file when the user cancels a draft before saving.

## Prerequisites

1. The delivered state was verified on 2026-06-24: typecheck with zero errors, the full unit
   suites of both apps, the complete audit suite, and both builds. Current audit counts live in
   the `AUDIT-COUNT` marker in `tests/audit/README.md`.
2. The code went through five review rounds; 16 findings were fixed before the status changed.

## Scope

### Step 1: Paid-to-paid plan change (DONE)

- [x] `web-1/src/domain/account/operations/account-plan-change.operations.ts`: subscription update
      with `proration_behavior: 'always_invoice'` and `payment_behavior: 'pending_if_incomplete'`.
      The new price applies to the subscription only after payment.
- [x] Pending-update guard: the same target re-surfaces the existing challenge, another target
      supersedes it
- [x] Webhook: `extractPlanIdFromSubscription` in
      `web-1/src/application/stripe/webhooks/stripe-webhooks.utils.ts` is price-first (the item
      price is authoritative; no fallback to subscription metadata when an item price exists)
- [x] Contract: `PlanChangeResponse` in
      `.shared-kernel/domain/user-and-account/account-checkout.types.ts` is a three-status
      discriminated union (`completed`, `requires_action`, `payment_failed`)
- [x] Tests: `web-1/src/domain/account/operations/account-plan-change.operations.test.ts` and
      `web-1/src/test-utils/integration/subscription-updated-price-first.test.ts`

### Step 2: Cached likes counter (DONE)

- [x] `cached_likes_count` on `StylistAccount` in `web-1/src/prisma/schema.prisma`, with DTO and
      kernel propagation
- [x] One owner for every mutation: `web-1/src/domain/favorites/operations/favorite-count.helper.ts`
      (increment, floored decrement, decrement for a deleted client), wired into 8 mutating points
- [x] Self-healing backfill on startup: `web-1/src/application/startup/cached-counts-backfill.ts`
- [x] Dashboard and public profile read the cached value

### Step 3: Draft-cancel of an upload (DONE)

- [x] `main/src/UI/features/gallery/hooks/useUploadGalleryRecord.ts`: keep the storage provider's
      delete token from the upload and use it on unmount when the record was never committed,
      with a guard for double effects and races
- [x] Deleting a committed record uses the existing backend operation; nothing new there

### Step 4: Owner verification (OPEN)

Action 1, payment scenarios. Step 1 changes how real payments behave and a bank challenge cannot
be fully covered by automated tests. Walk through a paid-to-paid change (for example Pro to
ProPlus) with the payment provider's published test cards: `4000 0025 0000 3155` (challenge
required, succeeds), `4000 0000 0000 0002` (generic decline), `4000 0000 0000 9995` (insufficient
funds).

- [ ] Happy path: challenge appears, confirm it; the plan switches in the app and the invoice is paid
- [ ] Abandoned challenge: close it without confirming; the plan stays on the OLD one and the
      invoice stays unpaid. Start the same change again: the same challenge re-surfaces and no
      second invoice is created. Confirm: the plan switches.
- [ ] Declined card: the UI shows a payment error, never a success state; the plan stays
- [ ] Double submit: two fast clicks create ONE pending update, not two

Action 2, upload preset.

- [ ] Confirm the upload preset returns a delete token with each upload. Without the token
      the draft-cancel does nothing (the rest of the upload works).

## Acceptance Criteria

- [x] `npm run typecheck`: zero errors (main/ and web-1/)
- [x] Build succeeds for both apps
- [x] `npm run audit:all` passes; `npm run test:unit` passes in main/ and web-1/
- [ ] All four payment scenarios behave as described
- [ ] An abandoned draft upload leaves no file behind

## References

- `web-1/README.md` (operation and handler conventions)
- `tests/README.md` and `tests/audit/README.md`
- The private changelog entry of 2026-06-24 and the schema decision record

## Execution Notes

**Delegation:** the three code steps (billing, favorites, upload) were executed by coding agents
under one orchestrating session, gated by typecheck, the unit suites and the audits, and followed
by the five review rounds mentioned above. Step 4 cannot be delegated.
**Risk:** Step 1 is a deliberate behaviour change in payments. If any scenario in Step 4 differs
from the description, report it before the change is relied on.
