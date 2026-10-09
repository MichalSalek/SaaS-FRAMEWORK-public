import { LP_ASSETS } from '../../assets/lpAssets';
import { describe, it, expect, vi } from 'vitest';

// REASON: @kernel/policies/seo.policy (and its transitive imports) live under
// READONLY-shared-kernel whose tsconfig.json extends '../tsconfig.base.json' —
// a path Vite's esbuild cannot resolve from the READONLY copy. Mock replicates
// the exact runtime domain value used in JSON-LD @id / url construction.
vi.mock('@kernel/policies/seo.policy', () => ({
  SEO_CONFIG: { domain: 'https://nailfolio.app' },
}));

import {
  buildNailSalonJsonLd,
  buildPersonJsonLd,
  buildBreadcrumbJsonLd,
  buildProfilePageJsonLd,
  type StylistProfileData,
} from './_jsonld.helpers';
import { SEO_CONFIG } from '@kernel/policies/seo.policy';

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
      address_country: 'PL',
      phone: '+48 123 456 789',
      website: 'https://anna.pl',
      description: 'Top stylistka',
      vanity_url: 'anna-kowalska',
      view_count: 100,
      instagram_handle: '@anna_nails',
      avatar_url: 'https://cdn.nailfolio.app/avatar.jpg',
      brand_accent_color: null,
      ...overrides,
    },
    gallery_records_count: 10,
    bookmark_count: 5,
    total_likes: 20,
  };
}

// ─── buildNailSalonJsonLd ────────────────────────────────────────────────────

describe('buildNailSalonJsonLd', () => {
  it('returns empty object when both display_name and business_name are null', () => {
    const profile = makeProfile({ display_name: null, business_name: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/acc-123/'
    );
    expect(result).toEqual({});
  });

  it('sets @type to NailSalon', () => {
    const profile = makeProfile();
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['@type']).toBe('NailSalon');
  });

  it('sets @context to https://schema.org', () => {
    const profile = makeProfile();
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['@context']).toBe('https://schema.org');
  });

  it('sets @id using vanity_url when available', () => {
    const profile = makeProfile({ vanity_url: 'anna-kowalska' });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['@id']).toBe(
      `${SEO_CONFIG.domain}/stylist/anna-kowalska/#nailsalon`
    );
  });

  it('falls back to account_id in @id when vanity_url is null', () => {
    const profile = makeProfile({ vanity_url: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/acc-123/'
    );
    expect(result['@id']).toBe(
      `${SEO_CONFIG.domain}/stylist/acc-123/#nailsalon`
    );
  });

  it('uses display_name as name', () => {
    const profile = makeProfile({ display_name: 'Anna Kowalska' });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['name']).toBe('Anna Kowalska');
  });

  it('falls back to business_name when display_name is null', () => {
    const profile = makeProfile({
      display_name: null,
      business_name: 'Nails by Anna',
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['name']).toBe('Nails by Anna');
  });

  it('keeps the name raw (escaping lives at the JSON-LD sink)', () => {
    const profile = makeProfile({ display_name: 'Anna <b>K</b>' });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['name']).toBe('Anna <b>K</b>');
  });

  it('sets url to canonicalUrl', () => {
    const canonicalUrl = 'https://nailfolio.app/stylist/anna-kowalska/';
    const profile = makeProfile();
    const result = buildNailSalonJsonLd(profile, canonicalUrl);
    expect(result['url']).toBe(canonicalUrl);
  });

  it('uses avatar_url as first image', () => {
    const profile = makeProfile({
      avatar_url: 'https://cdn.nailfolio.app/avatar.jpg',
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const images = result['image'] as string[];
    expect(images[0]).toBe('https://cdn.nailfolio.app/avatar.jpg');
  });

  it('falls back to og-default.png when avatar_url is null', () => {
    const profile = makeProfile({ avatar_url: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const images = result['image'] as string[];
    expect(images[0]).toBe(`${SEO_CONFIG.domain}${LP_ASSETS.seo.ogDefault}`);
  });

  it('sets inLanguage to pl-PL array', () => {
    const profile = makeProfile();
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['inLanguage']).toEqual(['pl-PL']);
  });

  it('includes address with city when address_city is set', () => {
    const profile = makeProfile({
      address_city: 'Kraków',
      address_country: 'PL',
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const address = result['address'] as Record<string, string>;
    expect(address['@type']).toBe('PostalAddress');
    expect(address['addressLocality']).toBe('Kraków');
    expect(address['addressCountry']).toBe('PL');
  });

  it('omits address when address_city is null', () => {
    const profile = makeProfile({ address_city: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('address' in result).toBe(false);
  });

  it('omits address_country when null', () => {
    const profile = makeProfile({
      address_city: 'Gdańsk',
      address_country: null,
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const address = result['address'] as Record<string, string>;
    expect('addressCountry' in address).toBe(false);
  });

  it('includes description when set', () => {
    const profile = makeProfile({ description: 'Great nails' });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['description']).toBe('Great nails');
  });

  it('omits description when null', () => {
    const profile = makeProfile({ description: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('description' in result).toBe(false);
  });

  it('includes telephone when phone is set', () => {
    const profile = makeProfile({ phone: '+48 100 200 300' });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['telephone']).toBe('+48 100 200 300');
  });

  it('omits telephone when phone is null', () => {
    const profile = makeProfile({ phone: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('telephone' in result).toBe(false);
  });

  it('builds sameAs from instagram_handle stripping leading @', () => {
    const profile = makeProfile({
      instagram_handle: '@my_nails',
      website: null,
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['sameAs']).toEqual(['https://instagram.com/my_nails']);
  });

  it('builds sameAs from instagram_handle without @', () => {
    const profile = makeProfile({
      instagram_handle: 'my_nails',
      website: null,
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['sameAs']).toEqual(['https://instagram.com/my_nails']);
  });

  it('omits sameAs when instagram_handle and website are null', () => {
    const profile = makeProfile({ instagram_handle: null, website: null });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('sameAs' in result).toBe(false);
  });

  it('adds website to sameAs next to instagram', () => {
    const profile = makeProfile({
      instagram_handle: 'my_nails',
      website: 'https://anna.pl/portfolio',
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['sameAs']).toEqual([
      'https://instagram.com/my_nails',
      'https://anna.pl/portfolio',
    ]);
  });

  it('emits website in sameAs even without instagram', () => {
    const profile = makeProfile({
      instagram_handle: null,
      website: 'https://anna.pl',
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result['sameAs']).toEqual(['https://anna.pl']);
  });

  it('drops a non-https website instead of emitting it', () => {
    const profile = makeProfile({
      instagram_handle: null,

      website: 'javascript:alert(1)',
    });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('sameAs' in result).toBe(false);
  });

  it('drops a blank website instead of emitting an empty entry', () => {
    const profile = makeProfile({ instagram_handle: null, website: '   ' });
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('sameAs' in result).toBe(false);
  });

  it('includes interactionStatistic with likes counter', () => {
    const profile = {
      ...makeProfile(),
      total_likes: 50,
      bookmark_count: 0,
      gallery_records_count: 0,
    };
    profile.account.view_count = 0;
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const stats = result['interactionStatistic'] as Array<
      Record<string, unknown>
    >;
    const like = stats.find(
      s =>
        (s['interactionType'] as Record<string, unknown>)['@type'] ===
        'LikeAction'
    );
    expect(like?.['userInteractionCount']).toBe(50);
  });

  it('includes interactionStatistic with bookmark counter', () => {
    const profile = { ...makeProfile(), total_likes: 0, bookmark_count: 3 };
    profile.account.view_count = 0;
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const stats = result['interactionStatistic'] as Array<
      Record<string, unknown>
    >;
    const bookmark = stats.find(
      s =>
        (s['interactionType'] as Record<string, unknown>)['@type'] ===
        'BookmarkAction'
    );
    expect(bookmark?.['userInteractionCount']).toBe(3);
  });

  it('includes interactionStatistic with view counter', () => {
    const profile = { ...makeProfile(), total_likes: 0, bookmark_count: 0 };
    profile.account.view_count = 200;
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const stats = result['interactionStatistic'] as Array<
      Record<string, unknown>
    >;
    const view = stats.find(
      s =>
        (s['interactionType'] as Record<string, unknown>)['@type'] ===
        'ViewAction'
    );
    expect(view?.['userInteractionCount']).toBe(200);
  });

  it('omits interactionStatistic when all counts are zero', () => {
    const profile = { ...makeProfile(), total_likes: 0, bookmark_count: 0 };
    profile.account.view_count = 0;
    const result = buildNailSalonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('interactionStatistic' in result).toBe(false);
  });
});

// ─── buildPersonJsonLd ────────────────────────────────────────────────────────

describe('buildPersonJsonLd', () => {
  it('returns null when both display_name and business_name are null', () => {
    const profile = makeProfile({ display_name: null, business_name: null });
    expect(
      buildPersonJsonLd(profile, 'https://nailfolio.app/stylist/acc-123/')
    ).toBeNull();
  });

  it('sets @type to Person', () => {
    const profile = makeProfile();
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['@type']).toBe('Person');
  });

  it('sets @context to https://schema.org', () => {
    const profile = makeProfile();
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['@context']).toBe('https://schema.org');
  });

  it('sets @id using vanity_url', () => {
    const profile = makeProfile({ vanity_url: 'anna-kowalska' });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['@id']).toBe(
      `${SEO_CONFIG.domain}/stylist/anna-kowalska/#person`
    );
  });

  it('sets @id using account_id when vanity_url is null', () => {
    const profile = makeProfile({ vanity_url: null });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/acc-123/'
    );
    expect(result?.['@id']).toBe(
      `${SEO_CONFIG.domain}/stylist/acc-123/#person`
    );
  });

  it('sets name to display_name', () => {
    const profile = makeProfile({ display_name: 'Anna Kowalska' });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['name']).toBe('Anna Kowalska');
  });

  it('sets jobTitle to "Stylistka paznokci"', () => {
    const profile = makeProfile();
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['jobTitle']).toBe('Stylistka paznokci');
  });

  it('sets knowsLanguage to ["pl"]', () => {
    const profile = makeProfile();
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['knowsLanguage']).toEqual(['pl']);
  });

  it('includes image when avatar_url is set', () => {
    const profile = makeProfile({
      avatar_url: 'https://cdn.nailfolio.app/avatar.jpg',
    });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['image']).toBe('https://cdn.nailfolio.app/avatar.jpg');
  });

  it('omits image when avatar_url is null', () => {
    const profile = makeProfile({ avatar_url: null });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('image' in (result ?? {})).toBe(false);
  });

  it('truncates description to 500 chars', () => {
    const longDesc = 'A'.repeat(600);
    const profile = makeProfile({ description: longDesc });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect((result?.['description'] as string).length).toBeLessThanOrEqual(500);
  });

  it('omits description when null', () => {
    const profile = makeProfile({ description: null });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('description' in (result ?? {})).toBe(false);
  });

  it('includes worksFor with NailSalon type', () => {
    const profile = makeProfile({
      business_name: 'Nails by Anna',
      display_name: 'Anna',
    });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const worksFor = result?.['worksFor'] as Record<string, unknown>;
    expect(worksFor?.['@type']).toBe('NailSalon');
    expect(worksFor?.['name']).toBe('Nails by Anna');
  });

  it('includes sameAs from instagram_handle', () => {
    const profile = makeProfile({ instagram_handle: '@anna_nails' });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect(result?.['sameAs']).toEqual(['https://instagram.com/anna_nails']);
  });

  it('includes address with city', () => {
    const profile = makeProfile({ address_city: 'Wrocław' });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    const address = result?.['address'] as Record<string, string>;
    expect(address?.['@type']).toBe('PostalAddress');
    expect(address?.['addressLocality']).toBe('Wrocław');
  });

  it('omits address when address_city is null', () => {
    const profile = makeProfile({ address_city: null });
    const result = buildPersonJsonLd(
      profile,
      'https://nailfolio.app/stylist/anna-kowalska/'
    );
    expect('address' in (result ?? {})).toBe(false);
  });
});

// ─── buildBreadcrumbJsonLd ────────────────────────────────────────────────────

describe('buildBreadcrumbJsonLd', () => {
  const canonicalUrl = 'https://nailfolio.app/stylist/anna-kowalska/';
  const displayName = 'Anna Kowalska';

  it('sets @type to BreadcrumbList', () => {
    const result = buildBreadcrumbJsonLd(canonicalUrl, displayName);
    expect(result['@type']).toBe('BreadcrumbList');
  });

  it('sets @context to https://schema.org', () => {
    const result = buildBreadcrumbJsonLd(canonicalUrl, displayName);
    expect(result['@context']).toBe('https://schema.org');
  });

  it('has exactly 2 itemListElement entries', () => {
    const result = buildBreadcrumbJsonLd(canonicalUrl, displayName);
    const items = result['itemListElement'] as unknown[];
    expect(items).toHaveLength(2);
  });

  it('first item is Nailfolio home at position 1', () => {
    const result = buildBreadcrumbJsonLd(canonicalUrl, displayName);
    const items = result['itemListElement'] as Array<Record<string, unknown>>;
    expect(items[0]?.['position']).toBe(1);
    expect(items[0]?.['name']).toBe('Nailfolio');
    expect(items[0]?.['item']).toBe(SEO_CONFIG.domain);
  });

  it('second item is the profile page at position 2', () => {
    const result = buildBreadcrumbJsonLd(canonicalUrl, displayName);
    const items = result['itemListElement'] as Array<Record<string, unknown>>;
    expect(items[1]?.['position']).toBe(2);
    expect(items[1]?.['name']).toBe(displayName);
    expect(items[1]?.['item']).toBe(canonicalUrl);
  });

  it('keeps displayName raw (escaping lives at the JSON-LD sink)', () => {
    const result = buildBreadcrumbJsonLd(canonicalUrl, 'Anna <b>K</b>');
    const items = result['itemListElement'] as Array<Record<string, unknown>>;
    expect(items[1]?.['name']).toBe('Anna <b>K</b>');
  });
});

// ─── buildProfilePageJsonLd ──────────────────────────────────────────────────

describe('buildProfilePageJsonLd', () => {
  const params = {
    canonicalUrl: 'https://nailfolio.app/stylist/anna-kowalska/',
    profileIdentifier: 'anna-kowalska',
    title: 'Anna Kowalska — Nailfolio',
    description: 'Profil stylistki Anna Kowalska',
    ogImage: 'https://cdn.nailfolio.app/og.jpg',
    breadcrumb: { '@type': 'BreadcrumbList' },
    nailSalon: { '@type': 'NailSalon', name: 'Nails by Anna' },
    person: { '@type': 'Person', name: 'Anna Kowalska' },
  };

  it('sets @type to ProfilePage', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['@type']).toBe('ProfilePage');
  });

  it('sets @context to https://schema.org', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['@context']).toBe('https://schema.org');
  });

  it('sets @id using profileIdentifier', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['@id']).toBe(
      `${SEO_CONFIG.domain}/stylist/anna-kowalska/#profilepage`
    );
  });

  it('sets url to canonicalUrl', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['url']).toBe(params.canonicalUrl);
  });

  it('sets inLanguage to pl-PL', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['inLanguage']).toBe('pl-PL');
  });

  it('sets primaryImageOfPage with ImageObject type', () => {
    const result = buildProfilePageJsonLd(params);
    const img = result['primaryImageOfPage'] as Record<string, string>;
    expect(img?.['@type']).toBe('ImageObject');
    expect(img?.['url']).toBe(params.ogImage);
  });

  it('sets breadcrumb to provided breadcrumb', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['breadcrumb']).toBe(params.breadcrumb);
  });

  it('sets mainEntity to nailSalon', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['mainEntity']).toBe(params.nailSalon);
  });

  it('includes about when person is not null', () => {
    const result = buildProfilePageJsonLd(params);
    expect(result['about']).toBe(params.person);
  });

  it('omits about when person is null', () => {
    const result = buildProfilePageJsonLd({ ...params, person: null });
    expect('about' in result).toBe(false);
  });

  it('keeps the title raw (escaping lives at the JSON-LD sink)', () => {
    const result = buildProfilePageJsonLd({
      ...params,
      title: 'Anna <script>',
    });
    expect(result['name']).toBe('Anna <script>');
  });

  it('keeps & in the description (no &amp; in data Google reads)', () => {
    const result = buildProfilePageJsonLd({
      ...params,
      description: 'Profil & test',
    });
    expect(result['description']).toBe('Profil & test');
  });
});

describe('localized default schema images', () => {
  it.each([
    ['en', LP_ASSETS.seo.ogDefaultEn],
    ['de', LP_ASSETS.seo.ogDefaultDe],
  ])('uses the %s card when the stylist has no avatar', (locale, expected) => {
    const data = buildNailSalonJsonLd(
      makeProfile({ avatar_url: null }),
      'https://nailfolio.app/stylist/anna/',
      locale
    );
    expect(data.image).toEqual([`https://nailfolio.app${expected}`]);
  });
  it('preserves the actual avatar for every locale', () => {
    const profile = makeProfile();
    for (const locale of ['pl', 'en', 'de']) {
      expect(
        buildNailSalonJsonLd(
          profile,
          'https://nailfolio.app/stylist/anna/',
          locale
        ).image
      ).toEqual([profile.account.avatar_url]);
    }
  });
});
