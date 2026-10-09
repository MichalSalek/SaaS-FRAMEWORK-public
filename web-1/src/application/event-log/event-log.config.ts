// Intended per-user retention bound for the EventLog LIFO trim (referenced by the
// DECISION in better-auth-failure-tracking.ts as the exposure cap for plaintext
// failed-login audit rows). This is a RETENTION limit, not a query page size.
export const MAX_EVENT_LOGS_PER_USER = 500;

// Max rows returned in a single getEventLogsByUser_IO page (cursor-paginated).
// Distinct from MAX_EVENT_LOGS_PER_USER (retention): a page never exceeds this,
// regardless of how many rows a user has retained.
export const MAX_EVENT_LOG_PAGE_SIZE = 100;
