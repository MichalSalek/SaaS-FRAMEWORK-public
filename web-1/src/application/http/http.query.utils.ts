/**
 * Parse a string ID query parameter (e.g., cuid).
 * Returns null if value is missing/empty.
 */
export const parseStringIdQueryParam = (
  value: string | string[] | undefined
): string | null => {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw || raw.trim().length === 0) {
    return null;
  }
  return raw;
};
