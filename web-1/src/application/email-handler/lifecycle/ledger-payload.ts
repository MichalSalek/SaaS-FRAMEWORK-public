/** Audit writes wrap response data; older records stored it directly. */
export const lifecycleMessageIdFromAudit = (
  payload: unknown
): string | null => {
  if (
    payload === null ||
    typeof payload !== 'object' ||
    Array.isArray(payload)
  ) {
    return null;
  }
  if (
    'lifecycleMessageId' in payload &&
    typeof payload.lifecycleMessageId === 'string'
  ) {
    return payload.lifecycleMessageId;
  }
  if ('responseBody' in payload) {
    return lifecycleMessageIdFromAudit(payload.responseBody);
  }
  return null;
};
