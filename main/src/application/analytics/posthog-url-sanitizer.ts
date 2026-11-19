import type { CaptureResult } from 'posthog-js';

const SENSITIVE_URL_PARAM =
  /([?&](?:token|authCode|auth|code|state|email|phone|session|password|pass|secret|key|signature|sig)=)[^&#]+/gi;

export function redactSensitiveUrl(value: string): string {
  return value.replace(SENSITIVE_URL_PARAM, '$1[REDACTED]');
}

export function redactPosthogUrlProperties(
  event: CaptureResult | null
): CaptureResult | null {
  if (event === null || event.properties === undefined) {
    return event;
  }

  const properties = { ...event.properties };
  for (const key of ['$current_url', '$referrer'] as const) {
    const value = properties[key];
    if (typeof value === 'string') {
      properties[key] = redactSensitiveUrl(value);
    }
  }
  return { ...event, properties };
}
