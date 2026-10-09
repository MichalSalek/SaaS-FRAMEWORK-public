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

export type SupportError =
  | SupportThreadNotFoundError
  | SupportThreadNotAuthorizedError
  | SupportThreadClosedError
  | SupportRateLimitedError;
