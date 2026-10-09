/**
 * Fuksja gazetowa light sRGB roles for e-mail clients and the standalone
 * newsletter landing. Source of truth: main/src/UI/styles/themes/palettes.css
 * (converted to hex, e-mail clients cannot read CSS custom properties); no
 * frontend runtime dependency. Lives in its own module so the renderer, the
 * bodies and the landing can all import it without forming a cycle
 * (renderer → content → bodies → renderer was a real madge cycle in S106).
 */
// Fuksja gazetowa light sRGB roles for email clients and standalone landing HTML.
// Source: main/src/UI/styles/themes/palettes.css; no frontend runtime dependency.
export const EMAIL_BRAND = {
  primary: '#c4207e',
  primaryContrast: '#fefdfc',
  bgMain: '#edebe7',
  bgCard: '#ffffff',
  ink: '#151411',
  textSecondary: '#484643',
  textMuted: '#5e5c58',
  divider: '#817e7b',
} as const;
