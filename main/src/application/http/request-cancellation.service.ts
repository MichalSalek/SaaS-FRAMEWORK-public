/**
 * Request Cancellation Service
 *
 * Registry of active HTTP requests with AbortController support.
 * Enables cancelling all pending requests on logout or identity switch.
 */

const activeRequests = new Map<string, AbortController>();

export const requestCancellationService = {
  /**
   * Register a new request and return its AbortSignal.
   * The signal should be passed to the axios call.
   */
  register(requestId: string): AbortSignal {
    const controller = new AbortController();
    activeRequests.set(requestId, controller);
    return controller.signal;
  },

  /**
   * Unregister a completed/failed request (cleanup).
   */
  unregister(requestId: string): void {
    activeRequests.delete(requestId);
  },

  /**
   * Cancel ALL pending requests (e.g. on logout).
   * Safe to call on empty registry (no-op).
   */
  cancelAll(): void {
    activeRequests.forEach(controller => controller.abort());
    activeRequests.clear();
  },

  /** Number of currently active (pending) requests. */
  get activeCount(): number {
    return activeRequests.size;
  },
} as const;
