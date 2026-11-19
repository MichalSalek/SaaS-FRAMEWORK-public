/** Place and note travel with a PENDING request and leave when the request is decided. */

export const CLEARED_PAIR_REQUEST_CONTEXT = {
  request_place: null,
  request_note: null,
} as const;

const blankToNull = (value: string | null | undefined): string | null => {
  if (value == null) {
    return null;
  }
  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
};

/** Stored columns for a new request or a re-request. Empty input clears a previous value. */
export const pairRequestContextWrite = (
  place: string | null | undefined,
  note: string | null | undefined
): { request_place: string | null; request_note: string | null } => ({
  request_place: blankToNull(place),
  request_note: blankToNull(note),
});
