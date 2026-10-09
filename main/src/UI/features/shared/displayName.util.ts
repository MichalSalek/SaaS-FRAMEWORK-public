// Display-name resolution — SSOT for "show a person's label / initials source"
// from the {display_name, email} pair that recurs across dashboard rows,
// drawer header and app-bar avatar. Pure, no React.

interface DisplayNameParts {
  displayName?: string | null;
  email?: string | null;
}

/**
 * Human-facing label: prefer the explicit display name, fall back to the full
 * email, then to a caller-supplied fallback (e.g. "Klientka").
 */
export function resolveDisplayLabel(
  parts: DisplayNameParts & { fallback: string }
): string {
  if (parts.displayName) {
    return parts.displayName;
  }
  if (parts.email) {
    return parts.email;
  }
  return parts.fallback;
}

/**
 * String to derive avatar initials from: the display name, else the local part
 * of the email (before "@"), else an empty string.
 */
export function resolveInitialsSource(parts: DisplayNameParts): string {
  if (parts.displayName) {
    return parts.displayName;
  }
  if (parts.email) {
    return parts.email.split('@')[0] ?? '';
  }
  return '';
}
