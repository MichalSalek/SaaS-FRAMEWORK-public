


export const FONT_FLOOR_PX = 16;

/**
 * Why a font-size value breaks the floor, or null. `value` has strings and comments removed.
 * @param {string} value
 */
export function fontFloorViolation(value) {
  const v = value.trim();
  const px = v.match(/^(\d*\.?\d+)px\b/i);
  if (px && parseFloat(px[1]) < FONT_FLOOR_PX) {
    return `raw ${px[1]}px below the ${FONT_FLOOR_PX}px floor`;
  }
  const relative = v.match(/^(\d*\.?\d+)(em|rem)\b/i);
  if (relative && parseFloat(relative[1]) < 1) {
    return `relative ${relative[1]}${relative[2]} below 1`;
  }
  const percent = v.match(/^(\d*\.?\d+)%/);
  if (percent && parseFloat(percent[1]) < 100) {
    return `percent ${percent[1]}% below 100`;
  }
  if (/\b(?:clamp|min|max)\(/i.test(v)) {
    const lengths = [
      ...[...v.matchAll(/([0-9.]+)px/gi)].map(m => parseFloat(m[1])),
      ...[...v.matchAll(/([0-9.]+)rem/gi)].map(m => parseFloat(m[1]) * 16),
    ].filter(n => !Number.isNaN(n));
    if (lengths.length > 0 && Math.min(...lengths) < FONT_FLOOR_PX) {
      return `${Math.min(...lengths)}px inside ${v.slice(0, 60)}`;
    }
  }
  return null;
}
