# Plan: Push Notifications (PNF)

> Date created: 2026-02-16 | Priority: LOW
> Status: DEFERRED (to be implemented after the core features are stable)
> Effort: ~10-15h (estimate); the admin mapping system below adds ~15-20h
> Dependency: push provider setup and a push plugin in the native wrapper (separate repository)

## DOCUMENTATION CASCADE (after the plan is finished)

> **MANDATORY: READ BEFORE IMPLEMENTING.** These updates are part of "done".

1. **`_MASTER_IMPLEMENTATION_INDEX.md`**: change the status to `DONE` plus the date
2. **Domain docs**: update the private push notification spec and the notification preferences section
3. **Changelog**: add an entry with a summary
4. **Delete** this plan file (git history keeps it)

- [ ] `_MASTER_IMPLEMENTATION_INDEX.md`, row PNF: status to DONE

---

## Goal

Deliver transactional and engagement push notifications to the native app: tell a stylist when a
client shares an inspiration session or pairs with her, and tell a client when a stylist responds.

### Why it is deferred (decision of 2026-02-16)

1. The native wrapper lives in a separate repository, so the work needs cross-repository coordination.
2. Push needs extra infrastructure (a messaging provider, platform credentials for both stores).
3. The key use cases do not need push. QR pairing happens with the client and the stylist in the
   same room, both looking at their phones. Session share is synchronous: both sides see the
   result at once.
4. The email lifecycle (a separate, delivered plan) already covers retention: trial nudges,
   win-back and engagement mails.
5. Priority: a stable core first (UI, email, analytics, moderation), push after that.

### Re-entry condition

- Engagement pushes are justified by usage data.
- The email lifecycle has run long enough to compare retention with and without push.
- The native wrapper is under active development (store releases on both platforms).

## Prerequisites

Verified state on 2026-08-18; the executor re-checks it before starting:

1. There is no push code: no push plugin, no web push keys, no service worker for push, no device
   token storage. The DEFERRED status matches the code.
2. The notification toggle in
   `main/src/UI/features/account/components/NotificationPrefsSection.organism.tsx` controls email
   only (`User.notifications_enabled` in `web-1/src/prisma/schema.prisma`). Its labels in all
   three locales say "email notifications". The `push*` i18n keys stay as they are (key names are
   a contract); only their values changed.
3. The copy search (`npm run copy:grep`, see `scripts/copy-grep.mjs`) for "push notifications" in
   the three locales returns nothing. Keep it that way until this plan ships: the UI must not
   name a channel that does not exist.

## Scope

### Step 1: Infrastructure

- [ ] Messaging provider project and platform credentials
- [ ] Push plugin in the native wrapper; register it per `main/src/UI/NATIVE_INTEGRATION_GUIDE.md`
- [ ] Opt-in is required before any push is sent

### Step 2: Backend (web-1)

- [ ] Device token storage: a `PushToken` model in `web-1/src/prisma/schema.prisma`
- [ ] Throttling: at most one push per day, transactional pushes excepted
- [ ] Quiet hours: 21:00 to 09:00

### Step 3: Transactional pushes

| Trigger | Recipient | Content |
|---------|-----------|---------|
| Client shares a session | Stylist | The client prepared an inspiration session, with the number of looks |
| Stylist shares a photo | Client | The stylist shared a look with you |
| New client paired | Stylist | New client, with her name |
| Session expired or closed | Stylist | The session ended; did the visit take place? |
| First session ever received | Stylist | A one-off celebration push with a deep link |
| Visit confirmed by the stylist | Client | The visit is confirmed |

### Step 4: Engagement pushes

Digest-style pushes for the stylist. The triggers and their frequency are defined when the
re-entry condition is met, from usage data.

### Step 5: Frontend (main)

- [ ] Preferences: Account, Notifications, one toggle per category (extends the existing section)

### Step 6 (pre-plan, not yet a plan): event-to-notification mapping in the admin panel

Without it every new trigger needs a deploy. Scope sketch:

- [ ] A `NotificationTemplate` model: event type, channel (push, email, in-app), template, enabled, throttle
- [ ] Admin UI: list of events, a toggle per channel, template editing with placeholders
- [ ] Scheduling ("send X minutes after the event"), per-user per-channel throttling, configurable quiet hours
- [ ] Two template variants per event with a random split

## Acceptance Criteria

- [ ] `npm run typecheck`: zero errors (main/ and web-1/)
- [ ] Build succeeds for both apps; `npm run audit:all` passes; `npm run test:unit` passes in both
- [ ] No push is sent without opt-in, inside quiet hours, or above the daily cap
- [ ] UI copy names push only after the channel works end to end

## References

- `main/src/UI/NATIVE_INTEGRATION_GUIDE.md` (adding a native plugin)
- `.shared-kernel/SHARED_KERNEL_GUIDE.md` (events and contracts)
- The private push notification spec in the domain docs

## Execution Notes

**Delegation:** not decided; this plan predates the template and is to be re-planned on re-entry.
Step 1 needs provider accounts and credentials and blocks the rest. The remaining steps follow
the usual order: kernel contract, backend slice, frontend feature.
**Risk:** two repositories must be coordinated; UI copy must not get ahead of the feature.
