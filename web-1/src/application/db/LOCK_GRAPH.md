# Row locking in PostgreSQL

Several operations update more than one record in a transaction. Acquiring those rows in a common order reduces the risk that each transaction waits on a row held by the other. The [order checker](lock-order.ts) tracks ranks, [row primitives](lock-rows.ts) issue the database statements, and [lock plans](lock-plans.ts) assemble the targets.

## The order

| Rank | Table | Primitive |
|---|---|---|
| 10 | `users` | `lockUserRow`, `lockInOrder` |
| 20 | `StylistAccount` | `lockStylistAccount`, `lockStylistAccountByOwnerUser`, `lockInOrder` |
| 30 | `ClientStylistPair` | `lockActivePair` (id in the order = `client:stylist`) |
| 40 | `SessionContainer` | `lockSessionContainer` (`lockSessionContainerRow`) |
| 50 | `VisitRecord` | `lockVisitRecord` |
| 60 | `GalleryRecord` | `lockGalleryRecord` (`FOR NO KEY UPDATE`) |
| 70 | `SupportThread` | `lockSupportThread` (`lockSupportThreadRow`) |

Within one table: ascending id (JS string comparison). `lockInOrder` sorts the rows of ONE call.
Locks the transaction already holds are policed by the checker (dev and unit tests only):
re-locking a held row in the same or weaker mode is allowed, a lower rank or id after a higher one
throws, and upgrading a `KEY SHARE`/`SHARE` lock throws (two holders upgrading deadlock).

The [model tests](lock-graph.test.ts) check ordering rules. The [PostgreSQL scenarios](../../../../tests/concurrency/lock-order.concurrency.ts) exercise selected operations concurrently.
