import { describe, expect, it } from 'vitest';
import {
  parsePlaygroundVariant,
  withPlaygroundVariant,
} from './playground-variant';

describe('playground variant seam', () => {
  it('reads only the candidate of the asked vote', () => {
    expect(parsePlaygroundVariant('clients:b', 'clients')).toBe('b');
    expect(parsePlaygroundVariant(['clients:b'], 'clients')).toBe('b');
    expect(parsePlaygroundVariant('contact:b', 'clients')).toBeNull();
  });

  it('rejects malformed values', () => {
    for (const raw of [undefined, '', 'clients', 'clients:', 'a:b:c', 7]) {
      expect(parsePlaygroundVariant(raw, 'clients')).toBeNull();
    }
  });

  it('builds hrefs that round-trip, keeping query and hash', () => {
    expect(withPlaygroundVariant('/app/', 'clients', null)).toBe('/app/');
    expect(withPlaygroundVariant('/app/', 'clients', 'b')).toBe(
      '/app/?pg=clients%3Ab'
    );
    expect(withPlaygroundVariant('/app/?tab=x#top', 'clients', 'b')).toBe(
      '/app/?tab=x&pg=clients%3Ab#top'
    );
    const url = new URL(
      withPlaygroundVariant('/app/', 'clients', 'b'),
      'https://x.test'
    );
    expect(parsePlaygroundVariant(url.searchParams.get('pg'), 'clients')).toBe(
      'b'
    );
  });
});
