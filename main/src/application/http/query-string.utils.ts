/** Build query string from params, skipping undefined/empty values.
 * Arrays are serialized as repeated keys: `key=a&key=b` */
export const buildQueryString = (
  params: Record<string, string | number | boolean | string[] | undefined>
): string => {
  const parts: string[] = [];
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === '') {
      continue;
    }
    if (Array.isArray(v)) {
      for (const item of v) {
        parts.push(`${k}=${encodeURIComponent(item)}`);
      }
    } else {
      parts.push(`${k}=${encodeURIComponent(String(v))}`);
    }
  }
  if (parts.length === 0) {
    return '';
  }
  return '?' + parts.join('&');
};
