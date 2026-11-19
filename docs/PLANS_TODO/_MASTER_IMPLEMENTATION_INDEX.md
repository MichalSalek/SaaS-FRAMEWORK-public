# Planning examples

These archival planning examples record the status and proposals at the time they were written. They are not a current roadmap or instructions for this export.

## Included plans

| Plan                                                      | Recorded status        | Remaining scope                                                 |
| --------------------------------------------------------- | ---------------------- | --------------------------------------------------------------- |
| [Stylist location fields](PLAN_STYLIST_GEO_FIELDS.md)     | Partial implementation | Opening-hours storage, editing and structured-data output       |
| [Payment and data handling](PLAN_PAYMENT_DATA_HYGIENE.md) | Code implemented       | Payment scenarios and upload-provider verification              |
| [Push notifications](PLAN_PUSH_NOTIFICATIONS.md)          | Core implemented       | Provider configuration, Android rebuild and device verification |

## Planning approach

A plan states the behavior, dependencies, implementation steps and acceptance
criteria. Contract work precedes dependent API and UI changes. Verification uses
the checks relevant to the affected layer, including a live environment where the
behavior depends on a database or external provider.

Code completion, deployment and manual acceptance are recorded separately.
The [template](_PLAN_TEMPLATE.md) shows the structure used in these examples.

## Related documentation

- [Feature development](../ADD_NEW_FEATURE_PLAYBOOK.md)
- [Shared kernel](../../.shared-kernel/SHARED_KERNEL_GUIDE.md)
- [Testing](../../tests/README.md)
