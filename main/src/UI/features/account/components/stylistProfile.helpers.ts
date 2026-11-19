/** The server stores phones without whitespace; the field keeps the person's
 *  formatting. Compare the same representation so a saved number stops looking
 *  dirty immediately, without rewriting what she typed. */
export function normalizePhoneForComparison(
  value: string | null | undefined
): string {
  return (value ?? '').replace(/\s+/g, '');
}
