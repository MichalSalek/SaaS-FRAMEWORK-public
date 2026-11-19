# Payment and data handling

> Archival example: recorded proposals and statuses are not a current roadmap or instructions for this export.

**Recorded status:** code implemented on 2026-06-24; manual verification remains.
This exported plan summarizes related changes to plan updates, cached counters
and canceled uploads.

## Purpose

A paid plan change can require additional payment authentication. The local plan
must reflect the confirmed subscription state. Separately, frequently read like
counts use a cached field, and canceled gallery drafts should release their uploads.

## Implemented behavior

### Subscription updates

The plan-change operation uses `proration_behavior: 'always_invoice'` and
`payment_behavior: 'pending_if_incomplete'`. The contract distinguishes `completed`,
`requires_action` and `payment_failed`. Webhook interpretation uses the subscription
item price when present rather than relying on metadata for the current plan.

Relevant files, relative to the repository root:

- `web-1/src/domain/account/operations/account-plan-change.operations.ts`
- `.shared-kernel/domain/user-and-account/account-checkout.types.ts`
- `web-1/src/application/stripe/webhooks/stripe-webhooks.utils.ts`

### Like counts

`StylistAccount.cached_likes_count` avoids recounting likes on each profile read.
The favorite-count helper coordinates increments and decrements across the relevant
write paths. Startup reconciliation supports existing data. Counter invariants
also require tests for concurrent changes.

### Canceled uploads

The gallery upload hook retains the provider's delete token and uses it when the
draft is abandoned before saving, with guards against repeated cleanup.

## Verification still recorded as open

- [ ] Complete and abandon payment-authentication scenarios using test-mode billing.
- [ ] Check the upload preset and verify deletion of an abandoned draft's asset.

These items require environment-level evidence. The recorded implementation status
does not establish that those checks have been completed.

## Completion record

After verification, update the planning record and affected domain documentation,
record the result in the change history and retire the active plan. This public
copy remains an example of the planning format.
