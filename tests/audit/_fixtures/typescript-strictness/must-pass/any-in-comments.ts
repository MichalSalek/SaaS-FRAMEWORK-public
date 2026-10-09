// Fail-open: any parse error is swallowed here on purpose.
/**
 * Returns: any of the configured hosts, whichever answers first.
 * Do not cast `as any` — see the DECISION in http.utils.ts.
 * The old `token!.value` idiom is gone; keep it out of this file.
 */
export const hosts = (list: readonly string[]): string[] => [...list];
