/**
 * Unit test — pii.crypto encode/decode symmetry.
 *
 * WHAT THIS PROTECTS
 * ──────────────────
 * `encodePii` (runtime, server-side) and `decodePii` (client, after interaction)
 * MUST be perfect inverses — a stylist phone is encoded in getServerSideProps and
 * decoded in the browser. Any asymmetry (key drift, base64/XOR bug) surfaces as a
 * garbled phone number + a dead `tel:` link. Also pins Unicode round-trip (Polish
 * diacritics / +() phone formatting chars).
 */

import { describe, it, expect } from 'vitest';
import { encodePii, decodePii } from './pii.crypto';

describe('pii.crypto encode/decode', () => {
  const samples = [
    '123456789',
    '+48 123 456 789',
    '(12) 345-67-89',
    '600700800',
    'zażółć gęślą jaźń', // Unicode / PL diacritics
    '',
  ];

  it('decodePii is the exact inverse of encodePii', () => {
    for (const s of samples) {
      expect(decodePii(encodePii(s))).toBe(s);
    }
  });

  it('encoded output is not the plaintext (obfuscated)', () => {
    const plain = '+48 600 700 800';
    const enc = encodePii(plain);
    expect(enc).not.toContain('600');
    expect(enc).not.toBe(plain);
  });
});
