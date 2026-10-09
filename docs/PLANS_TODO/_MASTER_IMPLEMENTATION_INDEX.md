# Master Implementation Index: Project Roadmap

> This is a condensed English rendering of the private roadmap index. It keeps the structure and
> three real plans as examples; the full index, the changelog and the domain docs are private.

> **Rules.** This index lists only UNFINISHED plans and is the single source of truth for the roadmap.
> A plan that reaches DONE moves its summary to the changelog, gets its name appended to "Completed"
> below, loses its table row, and its plan file is deleted (git history is the archive).

New plans start from [`_PLAN_TEMPLATE.md`](_PLAN_TEMPLATE.md).

---

## Roadmap

### Completed (details and metrics live in the private changelog)

In order of delivery: Shared Kernel, ID Migration, Type Safety, Domain Decoupling, Shared Kernel
Strengthening, Auth Migration (2026-04-14), Frontend Migration (2026-05-10), CQRS POST to GET
(2026-05-16), i18n Full Migration (2026-05-18), ESLint/TSConfig Tightening (2026-05-19), Dead Code
Cleanup (2026-05-20), Auth Middleware Type Safety (2026-05-30), Auth Token Transport (2026-06-04),
Slice Naming Consistency (2026-06-05), Frontend DX Refactor (2026-06-14), Backend DX Refactor
(2026-06-15), Framework Execution: request validators bound to the contract at compile time and
response contract binding (2026-06-17), Navigation Transitions (2026-07-08).

### Active and pending

| Plan | Status | Timing | Effort | Note |
|------|--------|--------|--------|------|
| **Stylist Geo Fields (SGF)** | PENDING | post-launch | ~5-8h (was ~10-15h) | Coordinates and opening hours in the `NailSalon` structured data. Scope halved after a code check on 2026-08-02: coordinates and geocoding already work. Left: expose coordinates in the public profile response (blocker), build opening hours from scratch, emit both in JSON-LD. File: [`PLAN_STYLIST_GEO_FIELDS.md`](PLAN_STYLIST_GEO_FIELDS.md). |
| **Payment and Data Hygiene (PDH)** | CODE DONE (2026-06-24) | owner-gated | none left for code | Three phases delivered: paid-to-paid plan change with strong customer authentication, denormalized likes counter, draft-cancel of uploads. Owner-side verification pending: manual payment scenarios and an upload preset check. File: [`PLAN_PAYMENT_DATA_HYGIENE.md`](PLAN_PAYMENT_DATA_HYGIENE.md). |
| **Push Notifications (PNF)** | DEFERRED | future | ~10-15h | The email lifecycle covers retention for now. Cross-repository work. No push code exists (checked 2026-08-18). Re-entry condition is stated in the plan. File: [`PLAN_PUSH_NOTIFICATIONS.md`](PLAN_PUSH_NOTIFICATIONS.md). |

**Post-launch order:** SGF first. PDH needs no further code.

### Backlog

| Item | Priority | Note |
|------|----------|------|
| Frontend quality residuals | post-launch | Left over from a delivered frontend quality plan: pixel-parity pass for shared empty and error states with screenshot diffing, and a per-route first-load JavaScript budget. Both need visual QA or profiling. |
| Unguarded database access audit | OPTIONAL | An AST-based audit for unguarded database access, plus a split of the gallery validation module. |
| Total counts in list responses | post-launch | The downgrade warning dialog needs a `total_count` in the responses of `GET_GALLERY_RECORDS` and `PAIRING_GET_MY_PAIRS`; the lists are paginated, so counting on the client would under-report. |
| End-to-end sweep | OPTIONAL | A browser sweep over every route and flow, watching network and console. Does not block a release. |

---

## Workflow

> Pick the first PENDING plan without a blocker, mark it IN PROGRESS, execute it step by step, run
> the documentation cascade, mark it DONE with the date, commit, then delete the plan file and its
> table row.

Plans are usually executed by coding agents under an orchestrating session. The gates are the same
for an agent and for a person: `npm run typecheck`, the build, `npm run audit:all`
(see `tests/audit/README.md`) and the unit suites (`npm run test:unit` in `main/` and `web-1/`),
plus the git hooks in `scripts/hooks/`.

## Related documents

| Area | Links |
|------|-------|
| Architecture | [`.shared-kernel/SHARED_KERNEL_GUIDE.md`](../../.shared-kernel/SHARED_KERNEL_GUIDE.md), [`main/src/UI/UI_ARCHITECTURE.md`](../../main/src/UI/UI_ARCHITECTURE.md), [`web-1/README.md`](../../web-1/README.md) |
| Tests and audits | [`tests/README.md`](../../tests/README.md), [`tests/audit/README.md`](../../tests/audit/README.md) |
