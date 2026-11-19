import { readFileSync } from 'fs';
import { join } from 'path';
import { describe, it, expect } from 'vitest';
import { OG_FONT_DIR, OG_FONT_FILES } from './ogCard.fonts';

// satori reads TTF, OTF and WOFF; a WOFF2 (the next/font format) would fail
// at request time and silently degrade every card to the static fallback.
const ACCEPTED_SIGNATURES = new Set([
  '00010000', // TrueType
  '4f54544f', // OTTO (CFF OpenType)
  '774f4646', // wOFF
]);

describe('OG card fonts', () => {
  it.each(OG_FONT_FILES.map(f => [f.file] as const))(
    '%s exists in a format satori reads',
    file => {
      const signature = readFileSync(join(OG_FONT_DIR, file))
        .subarray(0, 4)
        .toString('hex');
      expect(ACCEPTED_SIGNATURES.has(signature)).toBe(true);
    }
  );

  it('ships a licence for every face', () => {
    for (const licence of ['OFL-SchibstedGrotesk.txt', 'OFL-Marcellus.txt']) {
      expect(readFileSync(join(OG_FONT_DIR, licence), 'utf8')).toContain(
        'SIL Open Font License, Version 1.1'
      );
    }
  });
});
