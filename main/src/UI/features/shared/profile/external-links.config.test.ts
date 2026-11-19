import { describe, expect, it } from 'vitest';
import {
  detectExternalLinkService,
  formatExternalLinkLabel,
  normalizeExternalLink,
  sanitizeExternalLinks,
} from '@kernel/domain/user-and-account/external-links.config';

describe('external profile links', () => {
  it('prefixes a bare host with https and rejects non-https links', () => {
    expect(normalizeExternalLink('booksy.com/anna')).toBe(
      'https://booksy.com/anna'
    );
    expect(normalizeExternalLink('http://booksy.com/anna')).toBeNull();
    expect(normalizeExternalLink('javascript:alert(1)')).toBeNull();
  });

  it('detects the services the beauty market uses most', () => {
    expect(
      detectExternalLinkService('https://booksy.com/pl-pl/123')
    ).toMatchObject({ id: 'booksy', label: 'Booksy' });
    expect(
      detectExternalLinkService('https://www.fresha.com/a/salon')
    ).toMatchObject({ id: 'fresha', label: 'Fresha' });
    expect(
      detectExternalLinkService('https://treatwell.pl/salon')
    ).toMatchObject({ id: 'treatwell', label: 'Treatwell' });
    expect(
      detectExternalLinkService('https://instagram.com/anna')
    ).toMatchObject({ id: 'instagram', label: 'Instagram' });
  });

  it('caps, deduplicates and validates the saved list', () => {
    expect(
      sanitizeExternalLinks([
        'https://booksy.com/a',
        'https://booksy.com/a',
        'http://unsafe.example',
        'https://fresha.com/b',
        'https://instagram.com/c',
        'https://tiktok.com/@d',
      ])
    ).toEqual([
      'https://booksy.com/a',
      'https://fresha.com/b',
      'https://instagram.com/c',
    ]);
  });

  it('formats an arbitrary host without a protocol', () => {
    expect(formatExternalLinkLabel('https://studio.example.com/cennik/')).toBe(
      'studio.example.com/cennik'
    );
  });
});
