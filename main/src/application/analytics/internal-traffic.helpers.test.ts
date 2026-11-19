import { describe, expect, it } from 'vitest';
import {
  hasInternalTrafficCookie,
  parseInternalTrafficOverride,
} from './internal-traffic.helpers';

describe('internal traffic helpers', () => {
  it('recognizes explicit enable and disable query values', () => {
    expect(parseInternalTrafficOverride('?nf_internal=1')).toBe(true);
    expect(parseInternalTrafficOverride('?nf_internal=0')).toBe(false);
    expect(parseInternalTrafficOverride('?nf_internal=yes')).toBeNull();
    expect(parseInternalTrafficOverride('?other=1')).toBeNull();
  });

  it('matches the internal cookie by its exact name and value', () => {
    expect(hasInternalTrafficCookie('nf_internal=1')).toBe(true);
    expect(hasInternalTrafficCookie('other=1; nf_internal=1; x=y')).toBe(true);
    expect(hasInternalTrafficCookie('nf_internal=0')).toBe(false);
    expect(hasInternalTrafficCookie('xnf_internal=1')).toBe(false);
  });
});
