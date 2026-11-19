# Notification delivery

> Archival example: recorded proposals and statuses are not a current roadmap or instructions for this export.

**Recorded status:** core implemented on 2026-10-19; provider configuration and
Android device verification remain. The original push plan was superseded by a
broader notification implementation.

## Purpose

Store notifications in the application and deliver selected events through web
push or native push. The in-app record remains available independently of whether
a device can receive push.

## Implemented structure

`Notification` stores recipient events with a deduplication key. Domain-event
listeners create records for supported pairing, session, message, salon and support
outcomes. `PushSubscription` stores web-push or FCM device registrations.

Backend code under `web-1/src/domain/notifications/` coordinates dispatch and
provider adapters. The frontend under `main/src/domain/notifications/` and
`main/src/UI/features/notifications/` provides API declarations, the notification
screen and unread state.

The account preference controls activity notifications. A separate device opt-in
requests browser or operating-system permission. Provider secrets enable the
relevant transport; an in-app notification is not evidence of successful push.

## Remaining environment work

- [ ] Configure the messaging provider and backend credentials.
- [ ] Add the provider configuration to the separately maintained Android shell.
- [ ] Rebuild the shell and verify registration and delivery on a device.

The snapshot contains no credentials and no Android shell. Device delivery remains
unverified until those steps have evidence.

## Scope not implemented by this plan

Daily global push caps, quiet hours, category-level preferences, engagement
campaigns and an admin-configurable event mapping are outside the delivered core.
They need separate product decisions rather than being treated as setup steps.

## References

- [Native integration](../../main/src/UI/NATIVE_INTEGRATION_GUIDE.md)
- [Shared kernel](../../.shared-kernel/SHARED_KERNEL_GUIDE.md)
- [Roadmap examples](_MASTER_IMPLEMENTATION_INDEX.md)
