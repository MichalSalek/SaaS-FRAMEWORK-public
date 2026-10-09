/**
 * Branding-light publicznego profilu (BRANDING_VALUE_LADDER krok 1,
 * 2026-07-11): kolor akcentu z KURATOROWANEJ palety — nie wolny picker.
 * Użycie (stan faktyczny, S51): kolor barwi TŁO cover-banda profilu przez
 * color-mix z bg-subtle (--cover-mix ~46/52%), NIE tekst/fg. Kuratorowana
 * paleta ciemnych, stonowanych tonów gwarantuje czytelny tint-tło w light
 * i dark; walidacja „kolor ∈ paleta" domyka to bez liczenia kontrastu w
 * runtime (i odcina style-injection — do DB trafia tylko wartość z listy).
 * SSOT dla walidatora (kernel), pickera w koncie i renderu profilu.
 */
export const BRAND_ACCENT_PALETTE = Object.freeze([
  { id: 'rosewood', hex: '#8C2F45' }, // głęboki róż-bordowy (beauty klasyk)
  { id: 'terracotta', hex: '#A34A28' }, // ciepła terakota
  { id: 'espresso', hex: '#5B4030' }, // kawowy brąz
  { id: 'olive', hex: '#556B2F' }, // oliwka
  { id: 'forest', hex: '#1F5F3F' }, // butelkowa zieleń
  { id: 'teal', hex: '#0F6B6B' }, // morski
  { id: 'indigo', hex: '#3B3E8F' }, // indygo
  { id: 'plum', hex: '#6B2D5C' }, // śliwka
  { id: 'graphite', hex: '#3A3F45' }, // grafit (minimal)
  { id: 'crimson', hex: '#9E1B32' }, // karmin
] as const);

export const BRAND_ACCENT_HEXES: readonly string[] = Object.freeze(
  BRAND_ACCENT_PALETTE.map(c => c.hex)
);

export const isBrandAccentHex = (value: string): boolean =>
  BRAND_ACCENT_HEXES.includes(value);
