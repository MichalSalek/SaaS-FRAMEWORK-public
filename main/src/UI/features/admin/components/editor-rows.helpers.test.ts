import { describe, it, expect } from 'vitest';
import { estimateEditorRows } from './editor-rows.helpers';

describe('estimateEditorRows', () => {
  it('keeps the minimum for an empty or one-line text', () => {
    expect(estimateEditorRows('', 5, 16)).toBe(5);
    expect(estimateEditorRows('smoke-note-A-1791483691654', 5, 16)).toBe(5);
  });

  it('grows with line breaks and with long lines, one spare line included', () => {
    expect(estimateEditorRows('a\nb\nc\nd\ne\nf', 5, 16)).toBe(7);
    expect(estimateEditorRows('x'.repeat(36 * 8), 5, 16)).toBe(9);
  });

  it('never exceeds the maximum', () => {
    expect(estimateEditorRows('a\n'.repeat(80), 5, 16)).toBe(16);
  });
});
