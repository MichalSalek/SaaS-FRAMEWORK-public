export type SupportThreadNotFoundError = {
  type: 'SUPPORT_THREAD_NOT_FOUND';
  threadId: string;
};

export type SupportThreadNotAuthorizedError = {
  type: 'SUPPORT_THREAD_NOT_AUTHORIZED';
  threadId: string;
  userId: string;
};

export type SupportThreadClosedError = {
  type: 'SUPPORT_THREAD_CLOSED';
  threadId: string;
};

// Per-user hourly quota exceeded on support thread creation / message add
// (finding support-spam-flood). Maps to 429 Too Many Requests. currentCount/limit
// are informational (the caller's count in the rolling window vs the cap).
export type SupportRateLimitedError = {
  type: 'SUPPORT_RATE_LIMITED';
  currentCount: number;
  limit: number;
};

// Optimistic-concurrency conflict on admin change-status (finding support-1): the admin
// acted on a STALE snapshot (`expected_updated_at` no longer matches the thread, e.g. the
// user replied after the admin loaded the view). Maps to 409 Conflict; the admin UI
// refetches the thread and shows its own message.
export type SupportThreadStaleError = {
  type: 'SUPPORT_THREAD_STALE';
  threadId: string;
};

export type SupportError =
  | SupportThreadNotFoundError
  | SupportThreadNotAuthorizedError
  | SupportThreadClosedError
  | SupportThreadStaleError
  | SupportRateLimitedError;
