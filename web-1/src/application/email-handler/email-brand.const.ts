/**
 * Email-safe sRGB roles: product fuchsia and ink, with white reading surfaces.
 * Email clients cannot read the frontend CSS custom properties. Shared with the
 * standalone newsletter landing, without a frontend runtime dependency.
 */
export const EMAIL_BRAND = {
  primary: '#c4207e',
  primaryContrast: '#fefdfc',
  bgMain: '#ffffff',
  bgCard: '#ffffff',
  ink: '#151411',
  textSecondary: '#252321',
  textMuted: '#484643',
  divider: '#817e7b',
} as const;
