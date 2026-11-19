import { LP_ASSETS } from '../../assets/lpAssets';
import { describe, it, expect, vi } from 'vitest';

// Use a fixed SEO domain to isolate meta and Open Graph URL construction.
// These tests check the helper output, not the live domain policy or its dependencies.
vi.mock('@kernel/policies/seo.policy', () => ({
  SEO_CONFIG: { domain: 'https://nailfolio.app' },
}));

import { splitName, buildSeoMeta, getBackendUrl } from './_seo.helpers';
import type { StylistProfileData } from './_jsonld.helpers';

// ─── helpers ──────────────────────────────────────────────────────────────────

function makeProfile(
  overrides: Partial<StylistProfileData['account']> = {}
): StylistProfileData {
  return {
    account: {
      account_id: 'acc-123',
      display_name: 'Anna Kowalska',
      business_name: 'Nails by Anna',
      address_city: 'Warszawa',
      address_street: null,
      address_country: 'PL',
      phone: '+48 123 456 789',
      website: 'https://studio.example.com',
      description: 'Najlepsza stylistka w mieście',
      vanity_url: 'anna-kowalska',
      view_count: 100,
      instagram_handle: '@anna_nails',
      avatar_url: 'https://cdn.example.com/avatar.jpg',
      brand_accent_color: null,
      latitude: null,
      longitude: null,
      ...overrides,
    },
    gallery_records_count: 12,
    pinned_photo_urls: [],
    bookmark_count: 7,
    total_likes: 30,
  };
}

// ─── splitName ──────────────────────────────────────────────────────────────────

describe('splitName', () => {
  it('splits a two-part name into first and last', () => {
    expect(splitName('Anna Kowalska')).toEqual({
      first: 'Anna',
      last: 'Kowalska',
    });
  });

  it('returns null last for a single-word name', () => {
    expect(splitName('Anna')).toEqual({ first: 'Anna', last: null });
  });

  it('joins multi-part surnames into last', () => {
    expect(splitName('Anna Maria Kowalska-Nowak')).toEqual({
      first: 'Anna',
      last: 'Maria Kowalska-Nowak',
    });
  });

  it('collapses extra interior whitespace', () => {
    expect(splitName('Anna    Kowalska')).toEqual({
      first: 'Anna',
      last: 'Kowalska',
    });
  });

  it('trims leading and trailing whitespace', () => {
    expect(splitName('  Anna Kowalska  ')).toEqual({
      first: 'Anna',
      last: 'Kowalska',
    });
  });

  it('handles tabs and newlines as separators', () => {
    expect(splitName('Anna\tMaria\nKowalska')).toEqual({
      first: 'Anna',
      last: 'Maria Kowalska',
    });
  });
});

// ─── buildSeoMeta — not-found branch ───────────────────────────────────────────

describe('buildSeoMeta (no profile)', () => {
  const meta = buildSeoMeta(null, 'ghost-user');

  it('returns the generic not-found title and description', () => {
    expect(meta.title).toBe('Profil stylistki');
    expect(meta.description).toBe('Profil stylistki paznokci na Nailfolio.');
  });

  it('sets noindex true and a null ogImage', () => {
    expect(meta.noindex).toBe(true);
    expect(meta.ogImage).toBeNull();
  });

  it('uses the raw identifier in path and username, with null name parts', () => {
    expect(meta.path).toBe('/stylist/ghost-user');
    expect(meta.username).toBe('ghost-user');
    expect(meta.firstName).toBeNull();
    expect(meta.lastName).toBeNull();
  });
});

// ─── buildSeoMeta — populated profile ──────────────────────────────────────────

describe('buildSeoMeta (with profile)', () => {
  it('prefers the description (truncated to 160 chars) over the generated fallback', () => {
    const longDescription = 'x'.repeat(200);
    const meta = buildSeoMeta(
      makeProfile({ description: longDescription }),
      'ignored'
    );
    expect(meta.description).toBe('x'.repeat(160));
    expect(meta.description.length).toBe(160);
  });

  it('builds an indexable title with city and the per-stylist OG card', () => {
    const meta = buildSeoMeta(makeProfile(), 'ignored');
    expect(meta.noindex).toBe(false);
    expect(meta.title).toBe('Anna Kowalska, stylistka paznokci (Warszawa)');
    expect(meta.path).toBe('/stylist/anna-kowalska');
    // og:image = the dynamic card (DECISION in _seo.helpers.ts), canonical
    // identifier, trailing slash, no locale parameter for Polish.
    expect(meta.ogImage).toBe(
      'https://nailfolio.app/api/og/stylist/anna-kowalska/'
    );
    expect(meta.username).toBe('anna-kowalska');
    expect(meta.firstName).toBe('Anna');
    expect(meta.lastName).toBe('Kowalska');
  });

  it('omits the city from the title when address_city is null', () => {
    const meta = buildSeoMeta(
      makeProfile({ address_city: null, description: null }),
      'ignored'
    );
    expect(meta.title).toBe('Anna Kowalska, stylistka paznokci');
  });

  it('generates a city-aware fallback description when description is blank', () => {
    const meta = buildSeoMeta(makeProfile({ description: null }), 'ignored');
    expect(meta.description).toBe(
      'Portfolio stylistki paznokci Anna Kowalska (Warszawa) w Nailfolio. Galeria stylizacji, sesje inspiracji, kontakt.'
    );
  });

  it('generates a city-less fallback description when both description and city are blank', () => {
    const meta = buildSeoMeta(
      makeProfile({ description: null, address_city: null }),
      'ignored'
    );
    expect(meta.description).toBe(
      'Portfolio stylistki paznokci Anna Kowalska w Nailfolio. Galeria stylizacji, sesje inspiracji, kontakt.'
    );
  });

  it('treats a whitespace-only description as blank (falls through to fallback)', () => {
    const meta = buildSeoMeta(
      makeProfile({ description: '   ', address_city: null }),
      'ignored'
    );
    expect(meta.description).toBe(
      'Portfolio stylistki paznokci Anna Kowalska w Nailfolio. Galeria stylizacji, sesje inspiracji, kontakt.'
    );
  });

  it('falls back to account_id when vanity_url is null', () => {
    const meta = buildSeoMeta(
      makeProfile({ vanity_url: null, description: null }),
      'ignored'
    );
    expect(meta.path).toBe('/stylist/acc-123');
    expect(meta.username).toBe('acc-123');
    expect(meta.ogImage).toBe('https://nailfolio.app/api/og/stylist/acc-123/');
  });

  it('falls back to business_name when display_name is empty', () => {
    const meta = buildSeoMeta(
      makeProfile({ display_name: '', description: null, address_city: null }),
      'ignored'
    );
    expect(meta.title).toBe('Nails by Anna, stylistka paznokci');
    expect(meta.firstName).toBe('Nails');
    expect(meta.lastName).toBe('by Anna');
  });

  it('keeps a nameless profile out of the index with the plain fallback copy', () => {
    const meta = buildSeoMeta(
      makeProfile({
        display_name: '',
        business_name: '',
        description: null,
        address_city: 'Kraków',
      }),
      'ignored'
    );
    expect(meta.title).toBe('Profil stylistki');
    expect(meta.description).toBe('Profil stylistki paznokci na Nailfolio.');
    expect(meta.imageAlt).toBe('Profil stylistki paznokci na Nailfolio');
    expect(meta.noindex).toBe(true);
    expect(meta.firstName).toBeNull();
    expect(meta.lastName).toBeNull();
    expect(meta.path).toBe('/stylist/anna-kowalska');
  });

  it('treats a null display_name and business_name as nameless too', () => {
    const meta = buildSeoMeta(
      makeProfile({ display_name: null, business_name: null }),
      'ignored',
      'en'
    );
    expect(meta.title).toBe('Nail stylist profile');
    expect(meta.noindex).toBe(true);
  });
});

// ─── getBackendUrl ─────────────────────────────────────────────────────────────

describe('getBackendUrl', () => {
  it('composes protocol + domain + port from the env stubs', () => {
    // vitest.config.ts env stubs: http:// + localhost + 3001
    expect(getBackendUrl()).toBe('http://localhost:3001');
  });
});

describe('localized social images', () => {
  it.each([
    ['pl', 'https://nailfolio.app/api/og/stylist/anna-kowalska/'],
    ['en', 'https://nailfolio.app/api/og/stylist/anna-kowalska/?locale=en'],
    ['de', 'https://nailfolio.app/api/og/stylist/anna-kowalska/?locale=de'],
  ])(
    'points the %s profile page at the card in its language',
    (locale, expected) => {
      expect(buildSeoMeta(makeProfile(), 'anna', locale).ogImage).toBe(
        expected
      );
    }
  );

  it.each([
    ['pl', LP_ASSETS.seo.ogDefault],
    ['en', LP_ASSETS.seo.ogDefaultEn],
    ['de', LP_ASSETS.seo.ogDefaultDe],
  ])(
    'keeps the static %s card for a profile without a name',
    (locale, expected) => {
      const meta = buildSeoMeta(
        makeProfile({ display_name: null, business_name: null }),
        'anna',
        locale
      );
      expect(meta.ogImage).toBe(`https://nailfolio.app${expected}`);
    }
  );
});
