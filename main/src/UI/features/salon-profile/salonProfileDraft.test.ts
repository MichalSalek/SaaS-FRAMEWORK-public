import { describe, expect, it } from 'vitest';
import type { SalonProfileData } from '@kernel/models/salon-profile/salon-profile.dto';
import {
  buildSalonUpdate,
  canPublish,
  decideSlugCommit,
  differsFromSaved,
  fingerprint,
  initialDraft,
  isPublished,
  savedDraft,
} from './salonProfileDraft';

const fresh: SalonProfileData = {
  account_id: 'owner',
  name: 'Pracownia Monika G.',
  name_configured: false,
  salon_vanity_url: null,
  suggested_slug: 'pracownia-monika-g',
  brand_accent_color: null,
  show_team: true,
  owner: { account_id: 'owner', name: 'M', avatar_url: null, identifier: 'o' },
  members: [],
  works: [],
  contact: { address_city: null, website: null, instagram_handle: null },
};

describe('salon profile draft', () => {
  it('treats the suggested name and link as unsaved changes', () => {
    expect(initialDraft(fresh).name).toBe('Pracownia Monika G.');
    expect(initialDraft(fresh).slug).toBe('pracownia-monika-g');
    expect(fingerprint(initialDraft(fresh))).not.toBe(
      fingerprint(savedDraft(fresh))
    );
    expect(isPublished(fresh)).toBe(false);
  });
  it('has nothing to save once the name and link are stored', () => {
    const saved = {
      ...fresh,
      name_configured: true,
      salon_vanity_url: 'pracownia-monika-g',
    };
    expect(fingerprint(initialDraft(saved))).toBe(
      fingerprint(savedDraft(saved))
    );
    expect(isPublished(saved)).toBe(true);
  });
});

const published: SalonProfileData = {
  ...fresh,
  name_configured: true,
  salon_vanity_url: 'pracownia-monika-g',
  contact: {
    address_city: 'Kraków',
    website: 'https://monika.example.com',
    instagram_handle: 'monika.nails',
    external_links: ['https://booksy.com/pl-pl/123'],
    phone: null,
  },
  works: [
    { gallery_record_id: 'a', asset_url: 'x' },
    { gallery_record_id: 'b', asset_url: 'y' },
  ],
};

describe('first configuration', () => {
  it('publishes only with a name and a free valid link', () => {
    const ok = { name: 'Salon', validSlug: true } as const;
    expect(canPublish({ ...ok, availability: 'available' })).toBe(true);
    expect(canPublish({ ...ok, name: '  ', availability: 'available' })).toBe(
      false
    );
    expect(
      canPublish({ ...ok, validSlug: false, availability: 'available' })
    ).toBe(false);
    expect(canPublish({ ...ok, availability: 'checking' })).toBe(false);
    expect(canPublish({ ...ok, availability: 'taken' })).toBe(false);
  });
  it('sends the suggestions as the salon name and link on publish', () => {
    const request = buildSalonUpdate(initialDraft(fresh), 'pracownia-monika-g');
    expect(request.name).toBe('Pracownia Monika G.');
    expect(request.salon_vanity_url).toBe('pracownia-monika-g');
  });
});

describe('autosave of a published salon', () => {
  const saved = () =>
    buildSalonUpdate(savedDraft(published), 'pracownia-monika-g');
  it('sends nothing when a field only lost spaces or the pins changed order', () => {
    const draft = savedDraft(published);
    const request = buildSalonUpdate(
      {
        ...draft,
        name: `${draft.name} `,
        contact: { ...draft.contact, address_city: ' Kraków ' },
        pins: ['b', 'a'],
      },
      'pracownia-monika-g'
    );
    expect(differsFromSaved(request, published)).toBe(false);
    expect(differsFromSaved(saved(), published)).toBe(false);
  });
  it('saves a real change of any field', () => {
    const draft = savedDraft(published);
    expect(
      differsFromSaved(
        buildSalonUpdate({ ...draft, accent: '#aa0044' }, 'pracownia-monika-g'),
        published
      )
    ).toBe(true);
    expect(
      differsFromSaved(buildSalonUpdate(draft, 'nowy-link'), published)
    ).toBe(true);
  });
  it('normalises contact like the personal profile', () => {
    const draft = savedDraft(published);
    const request = buildSalonUpdate(
      {
        ...draft,
        contact: {
          ...draft.contact,
          website: 'monika.example.com',
          instagram_handle: '@monika.nails',
        },
      },
      'pracownia-monika-g'
    );
    expect(request.contact?.website).toBe('https://monika.example.com');
    expect(request.contact?.instagram_handle).toBe('monika.nails');
    expect(differsFromSaved(request, published)).toBe(false);
  });
  it('normalises and saves the salon links', () => {
    const draft = savedDraft(published);
    const request = buildSalonUpdate(
      {
        ...draft,
        contact: {
          ...draft.contact,
          external_links: [
            'booksy.com/pl-pl/456',
            'https://fresha.com/a/salon',
          ],
        },
      },
      'pracownia-monika-g'
    );
    expect(request.contact?.external_links).toEqual([
      'https://booksy.com/pl-pl/456',
      'https://fresha.com/a/salon',
    ]);
    expect(differsFromSaved(request, published)).toBe(true);
  });
  it('saves a changed link only once it is valid and free', () => {
    const base = { savedSlug: 'stary', valid: true } as const;
    expect(
      decideSlugCommit({ ...base, slug: 'stary', availability: 'checking' })
    ).toBe('unchanged');
    expect(
      decideSlugCommit({
        ...base,
        slug: 'n',
        valid: false,
        availability: 'available',
      })
    ).toBe('invalid');
    expect(
      decideSlugCommit({ ...base, slug: 'nowy', availability: 'checking' })
    ).toBe('wait');
    expect(
      decideSlugCommit({ ...base, slug: 'nowy', availability: 'available' })
    ).toBe('save');
    expect(
      decideSlugCommit({ ...base, slug: 'nowy', availability: 'taken' })
    ).toBe('refuse');
    expect(
      decideSlugCommit({ ...base, slug: 'nowy', availability: 'error' })
    ).toBe('refuse');
  });
});
