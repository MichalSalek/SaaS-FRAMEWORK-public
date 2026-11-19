import { describe, it, expect } from 'vitest';
import {
  normalizeInstagramHandle,
  normalizeWebsiteUrl,
} from './profile-input.helpers';

describe('normalizeInstagramHandle', () => {
  it('strips „@”, whitespace and unwraps a pasted profile URL', () => {
    expect(normalizeInstagramHandle('  @anna.nails_waw ')).toBe(
      'anna.nails_waw'
    );
    expect(
      normalizeInstagramHandle('https://www.instagram.com/anna.nails/?hl=pl')
    ).toBe('anna.nails');
    expect(normalizeInstagramHandle('instagram.com/@kasia_n')).toBe('kasia_n');
    expect(normalizeInstagramHandle('   ')).toBe('');
  });

  it('takes the account from a story link and keeps post/reel links raw', () => {
    expect(
      normalizeInstagramHandle('https://instagram.com/stories/anna.nails/123')
    ).toBe('anna.nails');
    // A post or reel link names no account: it stays raw, so the profile
    // editor shows its format error instead of storing `reel` or `p`.
    expect(
      normalizeInstagramHandle(
        'https://www.instagram.com/reel/CxAbCd/?igsh=abc'
      )
    ).toContain('instagram.com');
    expect(
      normalizeInstagramHandle('https://www.instagram.com/p/CxAbCd/')
    ).toContain('instagram.com');
  });
});

describe('normalizeWebsiteUrl', () => {
  it('adds https to a bare domain, keeps https and raises http', () => {
    expect(normalizeWebsiteUrl(' velvet-nails.example.com ')).toBe(
      'https://velvet-nails.example.com'
    );
    expect(normalizeWebsiteUrl('https://booksy.com/pl-pl/123')).toBe(
      'https://booksy.com/pl-pl/123'
    );
    expect(normalizeWebsiteUrl('HTTP://velvet-nails.example.com')).toBe(
      'https://velvet-nails.example.com'
    );
  });

  it('keeps an empty field empty', () => {
    expect(normalizeWebsiteUrl('   ')).toBe('');
  });
});
