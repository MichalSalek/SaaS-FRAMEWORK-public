import { describe, expect, it } from 'vitest';
import { countCodePoints } from '@kernel/policies/validation/validation.utils';
import {
  clampComposerContent,
  CONTENT_MAX,
} from './MessageThreadPage.parts.molecule';

describe('clampComposerContent (D5 code-point clamp)', () => {
  it('keeps a BMP string at the max without cutting a trailing ascii char', () => {
    const value = 'a'.repeat(CONTENT_MAX + 10);
    const clamped = clampComposerContent(value);
    expect(clamped).toHaveLength(CONTENT_MAX);
    expect(countCodePoints(clamped)).toBe(CONTENT_MAX);
  });

  it('counts an emoji as one character, not two UTF-16 units', () => {
    const value = `${'😀'.repeat(CONTENT_MAX)}x`;
    const clamped = clampComposerContent(value);
    expect(countCodePoints(clamped)).toBe(CONTENT_MAX);
    expect(clamped.endsWith('😀')).toBe(true);
    expect(clamped.includes('x')).toBe(false);
    expect(clamped.length).toBe(CONTENT_MAX * 2);
  });

  it('does not expose the counter band until 200 code points remain', () => {
    const justBelow = 'a'.repeat(CONTENT_MAX - 201);
    const atThreshold = 'a'.repeat(CONTENT_MAX - 200);
    expect(countCodePoints(justBelow) >= CONTENT_MAX - 200).toBe(false);
    expect(countCodePoints(atThreshold) >= CONTENT_MAX - 200).toBe(true);
  });
});
